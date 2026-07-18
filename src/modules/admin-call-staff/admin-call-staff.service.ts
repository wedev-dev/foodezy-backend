import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveCallStaffDto } from './dto/save-call-staff.dto';

export interface CallStaffRow {
  id: number;
  title: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

/**
 * This page manages only the *global* call-staff buttons (shop_id IS NULL) that
 * every shop inherits. Per-shop overrides carry a shop_id and belong to the
 * shop side, so every statement here is scoped to `shop_id IS NULL` to avoid
 * ever touching a shop's own rows.
 */
@Injectable()
export class AdminCallStaffService {
  private readonly logger = new Logger(AdminCallStaffService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async list(): Promise<CallStaffRow[]> {
    const rows = await this.dataSource.query<
      Array<{ id: number; title: string; isActive: number; sortOrder: number }>
    >(
      `SELECT id, title, is_active AS isActive, sort_order AS sortOrder
         FROM call_staff_templates
        WHERE shop_id IS NULL
        ORDER BY sort_order ASC, id ASC`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      isActive: Number(r.isActive) === 1,
      sortOrder: Number(r.sortOrder),
    }));
  }

  async create(dto: SaveCallStaffDto, actor: ActorMeta): Promise<{ id: number }> {
    // Append to the end of the current global list.
    const next = await this.dataSource.query<Array<{ nextOrder: number }>>(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM call_staff_templates WHERE shop_id IS NULL',
    );
    const sortOrder = Number(next[0]?.nextOrder ?? 1);

    const res = await this.dataSource.query<{ insertId: number }>(
      'INSERT INTO call_staff_templates (shop_id, title, is_active, sort_order) VALUES (NULL, ?, ?, ?)',
      [dto.title, dto.isActive ? 1 : 0, sortOrder],
    );
    const id = Number(res.insertId);
    await this.writeLog(actor, 'menus.call_staff_create', id, null, JSON.stringify(dto));
    return { id };
  }

  async update(id: number, dto: SaveCallStaffDto, actor: ActorMeta): Promise<void> {
    const before = await this.findGlobal(id);
    if (!before) throw new NotFoundException('ไม่พบหัวข้อนี้');

    await this.dataSource.query(
      'UPDATE call_staff_templates SET title = ?, is_active = ? WHERE id = ? AND shop_id IS NULL',
      [dto.title, dto.isActive ? 1 : 0, id],
    );
    await this.writeLog(
      actor,
      'menus.call_staff_update',
      id,
      JSON.stringify({ title: before.title, isActive: before.isActive }),
      JSON.stringify(dto),
    );
  }

  async toggle(id: number, isActive: boolean, actor: ActorMeta): Promise<void> {
    const before = await this.findGlobal(id);
    if (!before) throw new NotFoundException('ไม่พบหัวข้อนี้');

    await this.dataSource.query(
      'UPDATE call_staff_templates SET is_active = ? WHERE id = ? AND shop_id IS NULL',
      [isActive ? 1 : 0, id],
    );
    await this.writeLog(actor, 'menus.call_staff_toggle', id, null, JSON.stringify({ isActive }));
  }

  async remove(id: number, actor: ActorMeta): Promise<void> {
    const before = await this.findGlobal(id);
    if (!before) throw new NotFoundException('ไม่พบหัวข้อนี้');

    await this.dataSource.query(
      'DELETE FROM call_staff_templates WHERE id = ? AND shop_id IS NULL',
      [id],
    );
    await this.writeLog(
      actor,
      'menus.call_staff_delete',
      id,
      JSON.stringify({ title: before.title }),
      null,
    );
  }

  private async findGlobal(id: number): Promise<CallStaffRow | null> {
    const rows = await this.dataSource.query<
      Array<{ id: number; title: string; isActive: number; sortOrder: number }>
    >(
      `SELECT id, title, is_active AS isActive, sort_order AS sortOrder
         FROM call_staff_templates WHERE id = ? AND shop_id IS NULL`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: Number(r.id),
          title: r.title,
          isActive: Number(r.isActive) === 1,
          sortOrder: Number(r.sortOrder),
        }
      : null;
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
          targetType: 'call_staff_templates',
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
