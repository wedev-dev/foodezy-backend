import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveShopTypeDto } from './dto/save-shop-type.dto';

export interface ShopTypeRow {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminShopTypesService {
  private readonly logger = new Logger(AdminShopTypesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async list(): Promise<ShopTypeRow[]> {
    const rows = await this.dataSource.query<
      Array<{ id: number; name: string; isActive: number; createdAt: string; updatedAt: string }>
    >(
      `SELECT id, name, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
         FROM shop_types
        ORDER BY id ASC`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      isActive: Number(r.isActive) === 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async create(dto: SaveShopTypeDto, actor: ActorMeta): Promise<{ id: number }> {
    const res = await this.dataSource.query<{ insertId: number }>(
      'INSERT INTO shop_types (name, is_active) VALUES (?, ?)',
      [dto.name, dto.isActive ? 1 : 0],
    );
    const id = Number(res.insertId);
    await this.writeLog(actor, 'menus.shop_type_create', id, null, JSON.stringify(dto));
    return { id };
  }

  async update(id: number, dto: SaveShopTypeDto, actor: ActorMeta): Promise<void> {
    const before = await this.findOne(id);
    if (!before) throw new NotFoundException('ไม่พบประเภทร้านค้านี้');

    await this.dataSource.query(
      'UPDATE shop_types SET name = ?, is_active = ?, updated_at = NOW() WHERE id = ?',
      [dto.name, dto.isActive ? 1 : 0, id],
    );
    await this.writeLog(
      actor,
      'menus.shop_type_update',
      id,
      JSON.stringify({ name: before.name, isActive: before.isActive }),
      JSON.stringify(dto),
    );
  }

  async toggle(id: number, isActive: boolean, actor: ActorMeta): Promise<void> {
    const before = await this.findOne(id);
    if (!before) throw new NotFoundException('ไม่พบประเภทร้านค้านี้');

    await this.dataSource.query(
      'UPDATE shop_types SET is_active = ?, updated_at = NOW() WHERE id = ?',
      [isActive ? 1 : 0, id],
    );
    await this.writeLog(actor, 'menus.shop_type_toggle', id, null, JSON.stringify({ isActive }));
  }

  async remove(id: number, actor: ActorMeta): Promise<void> {
    const before = await this.findOne(id);
    if (!before) throw new NotFoundException('ไม่พบประเภทร้านค้านี้');

    // There is no FK from shops.shop_type_ids (a JSON array kept as text), so the
    // legacy page hard-deleted a type even while shops still referenced it,
    // leaving dangling ids. Block the delete instead and point the admin at the
    // toggle, which hides the type without corrupting shop records.
    const inUse = await this.countShopsUsing(id);
    if (inUse > 0) {
      throw new BadRequestException(
        `ยังมีร้านค้า ${inUse} ร้านใช้ประเภทนี้อยู่ — แนะนำให้ปิดใช้งานแทนการลบ`,
      );
    }

    await this.dataSource.query('DELETE FROM shop_types WHERE id = ?', [id]);
    await this.writeLog(
      actor,
      'menus.shop_type_delete',
      id,
      JSON.stringify({ name: before.name }),
      null,
    );
  }

  private async findOne(id: number): Promise<ShopTypeRow | null> {
    const rows = await this.dataSource.query<
      Array<{ id: number; name: string; isActive: number; createdAt: string; updatedAt: string }>
    >(
      `SELECT id, name, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
         FROM shop_types WHERE id = ?`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: Number(r.id),
          name: r.name,
          isActive: Number(r.isActive) === 1,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }
      : null;
  }

  /**
   * shop_type_ids is stored as a JSON array in text; older rows may hold either
   * numeric ([3]) or string (["3"]) ids, so both encodings are checked.
   * Malformed rows are skipped via JSON_VALID rather than throwing.
   */
  private async countShopsUsing(id: number): Promise<number> {
    const key = String(id);
    const rows = await this.dataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM shops
        WHERE deleted_at IS NULL
          AND shop_type_ids IS NOT NULL
          AND JSON_VALID(shop_type_ids)
          AND (JSON_CONTAINS(shop_type_ids, CAST(? AS JSON))
               OR JSON_CONTAINS(shop_type_ids, JSON_QUOTE(?)))`,
      [key, key],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  private async writeLog(
    actor: ActorMeta,
    action: string,
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
          targetType: 'shop_types',
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
