import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveFoodCategoryDto } from './dto/save-food-category.dto';

export interface FoodCategoryRow {
  id: number;
  name: string;
  nameEn: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

interface RawCategory {
  id: number;
  name: string;
  nameEn: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: number;
  createdAt: string;
}

const DEFAULT_ICON = 'fa-utensils';

@Injectable()
export class AdminFoodCategoriesService {
  private readonly logger = new Logger(AdminFoodCategoriesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async list(): Promise<FoodCategoryRow[]> {
    const rows = await this.dataSource.query<RawCategory[]>(
      `SELECT id, name, name_en AS nameEn, icon, sort_order AS sortOrder,
              is_active AS isActive, created_at AS createdAt
         FROM food_categories
        ORDER BY sort_order ASC, id ASC`,
    );
    return rows.map((r) => this.toRow(r));
  }

  async create(dto: SaveFoodCategoryDto, actor: ActorMeta): Promise<{ id: number }> {
    const res = await this.dataSource.query<{ insertId: number }>(
      `INSERT INTO food_categories (name, name_en, icon, sort_order, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [dto.name, dto.nameEn || null, dto.icon || DEFAULT_ICON, dto.sortOrder, dto.isActive ? 1 : 0],
    );
    const id = Number(res.insertId);
    await this.writeLog(actor, 'menus.food_category_create', id, null, JSON.stringify(dto));
    return { id };
  }

  async update(id: number, dto: SaveFoodCategoryDto, actor: ActorMeta): Promise<void> {
    const before = await this.findOne(id);
    if (!before) throw new NotFoundException('ไม่พบหมวดหมู่นี้');

    await this.dataSource.query(
      `UPDATE food_categories
          SET name = ?, name_en = ?, icon = ?, sort_order = ?, is_active = ?
        WHERE id = ?`,
      [dto.name, dto.nameEn || null, dto.icon || DEFAULT_ICON, dto.sortOrder, dto.isActive ? 1 : 0, id],
    );
    await this.writeLog(
      actor,
      'menus.food_category_update',
      id,
      JSON.stringify(before),
      JSON.stringify(dto),
    );
  }

  async toggle(id: number, isActive: boolean, actor: ActorMeta): Promise<void> {
    const before = await this.findOne(id);
    if (!before) throw new NotFoundException('ไม่พบหมวดหมู่นี้');

    await this.dataSource.query('UPDATE food_categories SET is_active = ? WHERE id = ?', [
      isActive ? 1 : 0,
      id,
    ]);
    await this.writeLog(actor, 'menus.food_category_toggle', id, null, JSON.stringify({ isActive }));
  }

  async remove(id: number, actor: ActorMeta): Promise<void> {
    const before = await this.findOne(id);
    if (!before) throw new NotFoundException('ไม่พบหมวดหมู่นี้');

    // menu_templates.category_id points here. Deleting a category that still has
    // template dishes (phase 4B data) would orphan them, so block it and let the
    // admin disable the category instead.
    const inUse = await this.countTemplatesUsing(id);
    if (inUse > 0) {
      throw new BadRequestException(
        `ยังมีเมนูต้นแบบ ${inUse} รายการอยู่ในหมวดนี้ — แนะนำให้ปิดใช้งานแทนการลบ`,
      );
    }

    await this.dataSource.query('DELETE FROM food_categories WHERE id = ?', [id]);
    await this.writeLog(actor, 'menus.food_category_delete', id, JSON.stringify(before), null);
  }

  private async findOne(id: number): Promise<FoodCategoryRow | null> {
    const rows = await this.dataSource.query<RawCategory[]>(
      `SELECT id, name, name_en AS nameEn, icon, sort_order AS sortOrder,
              is_active AS isActive, created_at AS createdAt
         FROM food_categories WHERE id = ?`,
      [id],
    );
    return rows[0] ? this.toRow(rows[0]) : null;
  }

  private async countTemplatesUsing(id: number): Promise<number> {
    const rows = await this.dataSource.query<Array<{ cnt: number }>>(
      'SELECT COUNT(*) AS cnt FROM menu_templates WHERE category_id = ?',
      [id],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  private toRow(r: RawCategory): FoodCategoryRow {
    return {
      id: Number(r.id),
      name: r.name,
      nameEn: r.nameEn,
      icon: r.icon,
      sortOrder: Number(r.sortOrder),
      isActive: Number(r.isActive) === 1,
      createdAt: r.createdAt,
    };
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
          targetType: 'food_categories',
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
