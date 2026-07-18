import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { ListMenuQueryDto } from './dto/list-menu-query.dto';
import { SaveMenuTemplateDto } from './dto/save-menu-template.dto';

export interface MenuTemplateListRow {
  id: number;
  categoryId: number;
  categoryName: string | null;
  name: string;
  nameEn: string | null;
  imageUrl: string | null;
  isActive: boolean;
  groupCount: number;
}

export interface MenuTemplateDetail {
  id: number;
  categoryId: number;
  name: string;
  nameEn: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  optionGroupIds: number[];
}

export interface MenuMeta {
  categories: Array<{ id: number; name: string }>;
  optionGroups: Array<{ id: number; name: string; itemCount: number }>;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

export interface UploadedImage {
  image?: Array<{ filename: string }>;
}

const PAGE_SIZE = 20;

@Injectable()
export class AdminMenuTemplatesService {
  private readonly logger = new Logger(AdminMenuTemplatesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    private readonly config: ConfigService,
  ) {}

  async list(
    query: ListMenuQueryDto,
  ): Promise<{ rows: MenuTemplateListRow[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, query.page ?? 1);
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.categoryId) {
      where.push('m.category_id = ?');
      params.push(query.categoryId);
    }
    if (query.search) {
      where.push('(m.name LIKE ? OR m.name_en LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRows = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM menu_templates m ${whereSql}`,
      params,
    );
    const total = Number(totalRows[0]?.total ?? 0);

    const rows = await this.dataSource.query<
      Array<{
        id: number;
        categoryId: number;
        categoryName: string | null;
        name: string;
        nameEn: string | null;
        imageUrl: string | null;
        isActive: number;
        groupCount: number;
      }>
    >(
      `SELECT m.id, m.category_id AS categoryId, c.name AS categoryName,
              m.name, m.name_en AS nameEn, m.image_url AS imageUrl, m.is_active AS isActive,
              (SELECT COUNT(*) FROM menu_template_option_groups g WHERE g.menu_template_id = m.id) AS groupCount
         FROM menu_templates m
         LEFT JOIN food_categories c ON c.id = m.category_id
         ${whereSql}
        ORDER BY m.id DESC
        LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );

    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        categoryId: Number(r.categoryId),
        categoryName: r.categoryName,
        name: r.name,
        nameEn: r.nameEn,
        imageUrl: r.imageUrl,
        isActive: Number(r.isActive) === 1,
        groupCount: Number(r.groupCount),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /** Dropdown data for the form: active categories + active option groups. */
  async meta(): Promise<MenuMeta> {
    const categories = await this.dataSource.query<Array<{ id: number; name: string }>>(
      `SELECT id, name FROM food_categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`,
    );
    const optionGroups = await this.dataSource.query<
      Array<{ id: number; name: string; itemCount: number }>
    >(
      `SELECT g.id, g.name,
              (SELECT COUNT(*) FROM global_option_items i
                WHERE i.global_option_group_id = g.id AND i.is_active = 1) AS itemCount
         FROM global_option_groups g
        WHERE g.is_active = 1
        ORDER BY g.sort_order ASC, g.id ASC`,
    );
    return {
      categories: categories.map((c) => ({ id: Number(c.id), name: c.name })),
      optionGroups: optionGroups.map((g) => ({
        id: Number(g.id),
        name: g.name,
        itemCount: Number(g.itemCount),
      })),
    };
  }

  async findOne(id: number): Promise<MenuTemplateDetail> {
    const rows = await this.dataSource.query<
      Array<{
        id: number;
        categoryId: number;
        name: string;
        nameEn: string | null;
        description: string | null;
        imageUrl: string | null;
        isActive: number;
      }>
    >(
      `SELECT id, category_id AS categoryId, name, name_en AS nameEn, description,
              image_url AS imageUrl, is_active AS isActive
         FROM menu_templates WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('ไม่พบเมนูต้นแบบนี้');

    const links = await this.dataSource.query<Array<{ gid: number }>>(
      'SELECT global_option_group_id AS gid FROM menu_template_option_groups WHERE menu_template_id = ? ORDER BY sort_order ASC, id ASC',
      [id],
    );
    return {
      id: Number(row.id),
      categoryId: Number(row.categoryId),
      name: row.name,
      nameEn: row.nameEn,
      description: row.description,
      imageUrl: row.imageUrl,
      isActive: Number(row.isActive) === 1,
      optionGroupIds: links.map((l) => Number(l.gid)),
    };
  }

  async create(
    dto: SaveMenuTemplateDto,
    files: UploadedImage,
    actor: ActorMeta,
  ): Promise<{ id: number }> {
    await this.assertCategory(dto.categoryId);
    const imageUrl = this.fileUrl(files.image?.[0]);
    const groupIds = await this.validGroupIds(dto.optionGroupIds);
    const isActive = dto.isActive === '0' ? 0 : 1;

    const id = await this.dataSource.transaction(async (trx) => {
      const res = await trx.query<{ insertId: number }>(
        `INSERT INTO menu_templates (category_id, name, name_en, description, image_url, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [dto.categoryId, dto.name, dto.nameEn || null, dto.description || null, imageUrl, isActive],
      );
      const newId = Number(res.insertId);
      await this.linkGroups(trx, newId, groupIds);
      return newId;
    });

    await this.writeLog(
      actor,
      'menus.menu_template_create',
      id,
      null,
      JSON.stringify({ name: dto.name, categoryId: dto.categoryId, optionGroupIds: groupIds }),
    );
    return { id };
  }

  async update(
    id: number,
    dto: SaveMenuTemplateDto,
    files: UploadedImage,
    actor: ActorMeta,
  ): Promise<void> {
    const current = await this.findOne(id);
    await this.assertCategory(dto.categoryId);
    const groupIds = await this.validGroupIds(dto.optionGroupIds);
    const isActive = dto.isActive === '0' ? 0 : 1;

    // Image: new upload replaces; removeImage clears; otherwise keep the old one.
    const uploaded = this.fileUrl(files.image?.[0]);
    let imageUrl = current.imageUrl;
    let imageToRemove: string | null = null;
    if (uploaded) {
      imageToRemove = current.imageUrl;
      imageUrl = uploaded;
    } else if (dto.removeImage === '1') {
      imageToRemove = current.imageUrl;
      imageUrl = null;
    }

    await this.dataSource.transaction(async (trx) => {
      await trx.query(
        `UPDATE menu_templates
            SET category_id = ?, name = ?, name_en = ?, description = ?, image_url = ?, is_active = ?
          WHERE id = ?`,
        [dto.categoryId, dto.name, dto.nameEn || null, dto.description || null, imageUrl, isActive, id],
      );
      await trx.query('DELETE FROM menu_template_option_groups WHERE menu_template_id = ?', [id]);
      await this.linkGroups(trx, id, groupIds);
    });

    // Only remove the file after the DB commit succeeds.
    await this.removeFile(imageToRemove);
    await this.writeLog(
      actor,
      'menus.menu_template_update',
      id,
      JSON.stringify({ name: current.name, optionGroupIds: current.optionGroupIds }),
      JSON.stringify({ name: dto.name, categoryId: dto.categoryId, optionGroupIds: groupIds }),
    );
  }

  async remove(id: number, actor: ActorMeta): Promise<void> {
    const current = await this.findOne(id);
    // menu_template_option_groups rows are removed via ON DELETE CASCADE.
    await this.dataSource.query('DELETE FROM menu_templates WHERE id = ?', [id]);
    await this.removeFile(current.imageUrl);
    await this.writeLog(actor, 'menus.menu_template_delete', id, JSON.stringify({ name: current.name }), null);
  }

  private async assertCategory(categoryId: number): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM food_categories WHERE id = ?',
      [categoryId],
    );
    if (!rows[0]) throw new BadRequestException('ไม่พบหมวดหมู่ที่เลือก');
  }

  /** Parse the JSON id list and keep only ids that really exist as groups. */
  private async validGroupIds(raw: string | undefined): Promise<number[]> {
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('รายการกลุ่มออฟชั่นไม่ถูกต้อง');
    }
    if (!Array.isArray(parsed)) return [];
    const ids = [...new Set(parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const found = await this.dataSource.query<Array<{ id: number }>>(
      `SELECT id FROM global_option_groups WHERE id IN (${placeholders})`,
      ids,
    );
    const foundSet = new Set(found.map((r) => Number(r.id)));
    return ids.filter((n) => foundSet.has(n));
  }

  private async linkGroups(trx: EntityManager, menuId: number, groupIds: number[]): Promise<void> {
    if (groupIds.length === 0) return;
    const values = groupIds.map(() => '(?, ?, ?)').join(', ');
    const params = groupIds.flatMap((gid, idx) => [menuId, gid, idx]);
    await trx.query(
      `INSERT INTO menu_template_option_groups (menu_template_id, global_option_group_id, sort_order)
       VALUES ${values}`,
      params,
    );
  }

  private fileUrl(file: { filename: string } | undefined): string | null {
    if (!file) return null;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    return `${prefix}/${file.filename}`;
  }

  /** Best-effort: only touches files we own under UPLOAD_URL_PREFIX; legacy
   *  images hosted elsewhere (absolute URLs / bare filenames) are left alone. */
  private async removeFile(url: string | null): Promise<void> {
    if (!url) return;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    if (!url.startsWith(`${prefix}/`)) return;
    const dir = this.config.get<string>('UPLOAD_DIR', './uploads');
    try {
      await unlink(join(dir, url.slice(prefix.length + 1)));
    } catch (err) {
      this.logger.warn(`could not delete ${url}: ${String(err)}`);
    }
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
          targetType: 'menu_templates',
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
