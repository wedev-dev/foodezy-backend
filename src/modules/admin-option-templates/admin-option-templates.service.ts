import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveOptionGroupDto } from './dto/save-option-group.dto';
import { SaveOptionItemDto } from './dto/save-option-item.dto';

export interface OptionItemRow {
  id: number;
  name: string;
  extraPrice: number;
  sortOrder: number;
  isActive: boolean;
}

export interface OptionGroupRow {
  id: number;
  name: string;
  selectionType: 'single' | 'multiple';
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
  items: OptionItemRow[];
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminOptionTemplatesService {
  private readonly logger = new Logger(AdminOptionTemplatesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  /** Groups with their items nested, both ordered by sort_order then id. */
  async listGroups(): Promise<OptionGroupRow[]> {
    const groups = await this.dataSource.query<
      Array<{
        id: number;
        name: string;
        selectionType: 'single' | 'multiple';
        isRequired: number;
        sortOrder: number;
        isActive: number;
      }>
    >(
      `SELECT id, name,
              default_selection_type AS selectionType,
              default_is_required    AS isRequired,
              sort_order             AS sortOrder,
              is_active              AS isActive
         FROM global_option_groups
        ORDER BY sort_order ASC, id ASC`,
    );

    if (groups.length === 0) return [];

    const items = await this.dataSource.query<
      Array<{
        id: number;
        groupId: number;
        name: string;
        extraPrice: string;
        sortOrder: number;
        isActive: number;
      }>
    >(
      `SELECT id, global_option_group_id AS groupId, name,
              default_extra_price AS extraPrice, sort_order AS sortOrder, is_active AS isActive
         FROM global_option_items
        ORDER BY sort_order ASC, id ASC`,
    );

    const byGroup = new Map<number, OptionItemRow[]>();
    for (const it of items) {
      const row: OptionItemRow = {
        id: Number(it.id),
        name: it.name,
        extraPrice: Number(it.extraPrice),
        sortOrder: Number(it.sortOrder),
        isActive: Number(it.isActive) === 1,
      };
      const key = Number(it.groupId);
      const list = byGroup.get(key);
      if (list) list.push(row);
      else byGroup.set(key, [row]);
    }

    return groups.map((g) => ({
      id: Number(g.id),
      name: g.name,
      selectionType: g.selectionType,
      isRequired: Number(g.isRequired) === 1,
      sortOrder: Number(g.sortOrder),
      isActive: Number(g.isActive) === 1,
      items: byGroup.get(Number(g.id)) ?? [],
    }));
  }

  async createGroup(dto: SaveOptionGroupDto, actor: ActorMeta): Promise<{ id: number }> {
    const res = await this.dataSource.query<{ insertId: number }>(
      `INSERT INTO global_option_groups
         (name, default_selection_type, default_is_required, sort_order, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [dto.name, dto.selectionType, dto.isRequired ? 1 : 0, dto.sortOrder, dto.isActive ? 1 : 0],
    );
    const id = Number(res.insertId);
    await this.writeLog(actor, 'menus.option_group_create', 'global_option_groups', id, null, JSON.stringify(dto));
    return { id };
  }

  async updateGroup(id: number, dto: SaveOptionGroupDto, actor: ActorMeta): Promise<void> {
    const found = await this.groupExists(id);
    if (!found) throw new NotFoundException('ไม่พบกลุ่มออฟชั่นนี้');

    await this.dataSource.query(
      `UPDATE global_option_groups
          SET name = ?, default_selection_type = ?, default_is_required = ?, sort_order = ?, is_active = ?
        WHERE id = ?`,
      [dto.name, dto.selectionType, dto.isRequired ? 1 : 0, dto.sortOrder, dto.isActive ? 1 : 0, id],
    );
    await this.writeLog(actor, 'menus.option_group_update', 'global_option_groups', id, null, JSON.stringify(dto));
  }

  async deleteGroup(id: number, actor: ActorMeta): Promise<void> {
    const found = await this.groupExists(id);
    if (!found) throw new NotFoundException('ไม่พบกลุ่มออฟชั่นนี้');

    // The FK on menu_template_option_groups is ON DELETE CASCADE, so deleting a
    // group would silently strip it from every menu template that uses it.
    // Block instead and let the admin unlink or disable it first.
    const linked = await this.dataSource.query<Array<{ cnt: number }>>(
      'SELECT COUNT(*) AS cnt FROM menu_template_option_groups WHERE global_option_group_id = ?',
      [id],
    );
    const inUse = Number(linked[0]?.cnt ?? 0);
    if (inUse > 0) {
      throw new BadRequestException(
        `ยังมีเมนูต้นแบบ ${inUse} รายการผูกกลุ่มออฟชั่นนี้อยู่ — แนะนำให้ปิดใช้งานแทนการลบ`,
      );
    }

    // Its items go with it via ON DELETE CASCADE.
    await this.dataSource.query('DELETE FROM global_option_groups WHERE id = ?', [id]);
    await this.writeLog(actor, 'menus.option_group_delete', 'global_option_groups', id, null, null);
  }

  async addItem(groupId: number, dto: SaveOptionItemDto, actor: ActorMeta): Promise<{ id: number }> {
    const found = await this.groupExists(groupId);
    if (!found) throw new NotFoundException('ไม่พบกลุ่มออฟชั่นนี้');

    const res = await this.dataSource.query<{ insertId: number }>(
      `INSERT INTO global_option_items
         (global_option_group_id, name, default_extra_price, sort_order, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [groupId, dto.name, dto.extraPrice, dto.sortOrder, dto.isActive ? 1 : 0],
    );
    const id = Number(res.insertId);
    await this.writeLog(
      actor,
      'menus.option_item_create',
      'global_option_items',
      id,
      null,
      JSON.stringify({ groupId, ...dto }),
    );
    return { id };
  }

  async updateItem(id: number, dto: SaveOptionItemDto, actor: ActorMeta): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM global_option_items WHERE id = ?',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบตัวเลือกนี้');

    await this.dataSource.query(
      `UPDATE global_option_items
          SET name = ?, default_extra_price = ?, sort_order = ?, is_active = ?
        WHERE id = ?`,
      [dto.name, dto.extraPrice, dto.sortOrder, dto.isActive ? 1 : 0, id],
    );
    await this.writeLog(actor, 'menus.option_item_update', 'global_option_items', id, null, JSON.stringify(dto));
  }

  async deleteItem(id: number, actor: ActorMeta): Promise<void> {
    const result = await this.dataSource.query<{ affectedRows?: number }>(
      'DELETE FROM global_option_items WHERE id = ?',
      [id],
    );
    if (result?.affectedRows === 0) throw new NotFoundException('ไม่พบตัวเลือกนี้');
    await this.writeLog(actor, 'menus.option_item_delete', 'global_option_items', id, null, null);
  }

  private async groupExists(id: number): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM global_option_groups WHERE id = ?',
      [id],
    );
    return Boolean(rows[0]);
  }

  private async writeLog(
    actor: ActorMeta,
    action: string,
    targetType: string,
    targetId: number,
    oldValue: string | null,
    newValue: string | null,
  ): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: actor.adminId,
          action,
          targetType,
          targetId,
          oldValue,
          newValue,
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        }),
      );
    } catch (err) {
      this.logger.warn(`audit_log write failed (${action}): ${String(err)}`);
    }
  }
}
