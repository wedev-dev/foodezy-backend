import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { MenuDto } from './dto/menu.dto';
import { ShopCategoriesService } from './shop-categories.service';
import { ShopOptionsService } from './shop-options.service';

export interface PickCategory { id: number; name: string }
export interface PickGroup { id: number; name: string }
export interface MenuRow {
  id: number; categoryId: number; categoryName: string; name: string; nameEn: string | null;
  description: string | null; price: number; imageUrl: string | null; isAvailable: boolean;
  isRecommended: boolean; sortOrder: number; menuPricingType: string; optionGroupIds: number[];
}
export interface TemplateRow {
  id: number; name: string; nameEn: string | null; description: string | null;
  imageUrl: string | null; categoryId: number; categoryName: string; alreadyAdded: boolean;
}
export interface UploadedImage { image?: Array<{ filename: string }> }

@Injectable()
export class ShopMenusService {
  private readonly logger = new Logger(ShopMenusService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly categories: ShopCategoriesService,
    private readonly options: ShopOptionsService,
  ) {}

  async list(shopId: number): Promise<{ categories: PickCategory[]; optionGroups: PickGroup[]; menus: MenuRow[] }> {
    const categories = await this.dataSource.query<PickCategory[]>(
      `SELECT id, name FROM shop_foodcategories WHERE shop_id = ? AND is_active = 1
        ORDER BY sort_order ASC, name ASC`,
      [shopId],
    );
    const optionGroups = await this.dataSource.query<PickGroup[]>(
      `SELECT id, name FROM shop_option_groups WHERE shop_id = ? ORDER BY sort_order ASC, id ASC`,
      [shopId],
    );
    const links = await this.dataSource.query<Array<{ menuId: number; groupId: number }>>(
      `SELECT mog.menu_id AS menuId, mog.shop_option_group_id AS groupId
         FROM menu_option_groups mog
         JOIN shop_menus m ON m.id = mog.menu_id
        WHERE m.shop_id = ?`,
      [shopId],
    );
    const raw = await this.dataSource.query<
      Array<Omit<MenuRow, 'price' | 'isAvailable' | 'isRecommended'> & { price: string; isAvailable: number; isRecommended: number }>
    >(
      `SELECT m.id, m.category_id AS categoryId, c.name AS categoryName, m.name, m.name_en AS nameEn,
              m.description, m.price, m.image_url AS imageUrl, m.is_available AS isAvailable,
              m.is_recommended AS isRecommended, m.sort_order AS sortOrder, m.menu_pricing_type AS menuPricingType
         FROM shop_menus m
         JOIN shop_foodcategories c ON c.id = m.category_id
        WHERE m.shop_id = ?
        ORDER BY c.sort_order ASC, m.sort_order ASC, m.id ASC`,
      [shopId],
    );
    const menus = raw.map((r) => ({
      ...r, price: Number(r.price),
      isAvailable: Number(r.isAvailable) === 1, isRecommended: Number(r.isRecommended) === 1,
      optionGroupIds: links.filter((l) => l.menuId === r.id).map((l) => l.groupId),
    }));
    return { categories, optionGroups, menus };
  }

  async create(shopId: number, dto: MenuDto, files: UploadedImage): Promise<{ id: number }> {
    await this.categories.assertOwned(shopId, Number(dto.categoryId));
    const imageUrl = this.fileUrl(files.image?.[0]);
    const res = await this.dataSource.query(
      `INSERT INTO shop_menus
         (shop_id, category_id, name, name_en, description, price, image_url,
          is_available, is_recommended, sort_order, menu_pricing_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId, Number(dto.categoryId), dto.name.trim(), dto.nameEn || null, dto.description || null,
        dto.price ? Number(dto.price) : 0, imageUrl,
        dto.isAvailable === '0' ? 0 : 1, dto.isRecommended === '1' ? 1 : 0,
        dto.sortOrder ? Number(dto.sortOrder) : 0, dto.menuPricingType ?? 'normal',
      ],
    );
    const id = Number((res as { insertId: number }).insertId);
    await this.linkGroups(shopId, id, this.parseIds(dto.optionGroupIds));
    return { id };
  }

  async update(shopId: number, id: number, dto: MenuDto, files: UploadedImage): Promise<void> {
    const current = await this.getOwned(shopId, id);
    await this.categories.assertOwned(shopId, Number(dto.categoryId));
    const uploaded = this.fileUrl(files.image?.[0]);
    let imageUrl = current.image_url;
    let toRemove: string | null = null;
    if (uploaded) { toRemove = current.image_url; imageUrl = uploaded; }
    else if (dto.removeImage === '1') { toRemove = current.image_url; imageUrl = null; }

    await this.dataSource.query(
      `UPDATE shop_menus SET
         category_id = ?, name = ?, name_en = ?, description = ?, price = ?, image_url = ?,
         is_available = ?, is_recommended = ?, sort_order = ?, menu_pricing_type = ?
       WHERE id = ? AND shop_id = ?`,
      [
        Number(dto.categoryId), dto.name.trim(), dto.nameEn || null, dto.description || null,
        dto.price ? Number(dto.price) : 0, imageUrl,
        dto.isAvailable === '0' ? 0 : 1, dto.isRecommended === '1' ? 1 : 0,
        dto.sortOrder ? Number(dto.sortOrder) : 0, dto.menuPricingType ?? 'normal', id, shopId,
      ],
    );
    await this.linkGroups(shopId, id, this.parseIds(dto.optionGroupIds));
    await this.removeFile(toRemove);
  }

  async remove(shopId: number, id: number): Promise<void> {
    const current = await this.getOwned(shopId, id);
    await this.dataSource.query('DELETE FROM menu_option_groups WHERE menu_id = ?', [id]);
    await this.dataSource.query('DELETE FROM shop_menus WHERE id = ? AND shop_id = ?', [id, shopId]);
    await this.removeFile(current.image_url);
  }

  async toggle(shopId: number, id: number, isAvailable: boolean): Promise<void> {
    await this.getOwned(shopId, id);
    await this.dataSource.query(
      'UPDATE shop_menus SET is_available = ? WHERE id = ? AND shop_id = ?',
      [isAvailable ? 1 : 0, id, shopId],
    );
  }

  // ---------- เมนูต้นแบบ (menu_templates) ----------
  async templates(shopId: number): Promise<TemplateRow[]> {
    const rows = await this.dataSource.query<Array<Omit<TemplateRow, 'alreadyAdded'> & { alreadyAdded: number }>>(
      `SELECT t.id, t.name, t.name_en AS nameEn, t.description, t.image_url AS imageUrl,
              t.category_id AS categoryId, g.name AS categoryName,
              EXISTS(SELECT 1 FROM shop_menus m WHERE m.shop_id = ? AND m.template_id = t.id) AS alreadyAdded
         FROM menu_templates t
         JOIN food_categories g ON g.id = t.category_id
        WHERE t.is_active = 1
        ORDER BY g.sort_order ASC, t.name ASC`,
      [shopId],
    );
    return rows.map((r) => ({ ...r, alreadyAdded: Number(r.alreadyAdded) === 1 }));
  }

  // clone template ที่เลือก (หรือทั้งหมดถ้าไม่ส่ง ids) เข้าตารางร้าน — ข้ามอันที่ดึงแล้ว
  async cloneTemplates(shopId: number, templateIds: number[] | null): Promise<{ added: number }> {
    const all = await this.templates(shopId);
    const targets = all.filter((t) => !t.alreadyAdded && (templateIds === null || templateIds.includes(t.id)));
    let added = 0;
    for (const t of targets) {
      const catId = await this.categories.resolveFromTemplate(shopId, t.categoryId);
      const sort = await this.nextSort(shopId);
      const cleanImg = t.imageUrl ? t.imageUrl.replace('foodsimg/', '') : null;
      const res = await this.dataSource.query(
        `INSERT INTO shop_menus
           (shop_id, template_id, category_id, name, name_en, description, price, image_url,
            is_available, is_recommended, sort_order, menu_pricing_type)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, 0, ?, 'normal')`,
        [shopId, t.id, catId, t.name, t.nameEn, t.description, cleanImg, sort],
      );
      const menuId = Number((res as { insertId: number }).insertId);

      // ดึง "ออฟชั่นแนะนำ" ที่ admin ผูกไว้กับเมนูต้นแบบ -> สร้างในร้าน (ถ้ายังไม่มี) + ผูกเข้าเมนูอัตโนมัติ
      const suggested = await this.dataSource.query<Array<{ gid: number }>>(
        'SELECT global_option_group_id AS gid FROM menu_template_option_groups WHERE menu_template_id = ? ORDER BY sort_order ASC',
        [t.id],
      );
      const groupIds: number[] = [];
      for (const sg of suggested) {
        const shopGroupId = await this.options.resolveGlobalGroup(shopId, Number(sg.gid));
        if (shopGroupId) groupIds.push(shopGroupId);
      }
      if (groupIds.length) await this.linkGroups(shopId, menuId, groupIds);
      added += 1;
    }
    return { added };
  }

  private parseIds(raw: string | undefined): number[] {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    } catch { return []; }
  }

  private async linkGroups(shopId: number, menuId: number, groupIds: number[]): Promise<void> {
    await this.dataSource.query('DELETE FROM menu_option_groups WHERE menu_id = ?', [menuId]);
    if (!groupIds.length) return;
    // ผูกเฉพาะกลุ่มที่เป็นของร้านนี้จริง
    const owned = await this.dataSource.query<Array<{ id: number }>>(
      `SELECT id FROM shop_option_groups WHERE shop_id = ? AND id IN (${groupIds.map(() => '?').join(',')})`,
      [shopId, ...groupIds],
    );
    let sort = 0;
    for (const g of owned) {
      await this.dataSource.query(
        'INSERT INTO menu_option_groups (menu_id, shop_option_group_id, sort_order) VALUES (?, ?, ?)',
        [menuId, g.id, sort],
      );
      sort += 1;
    }
  }

  private async nextSort(shopId: number): Promise<number> {
    const rows = await this.dataSource.query<Array<{ s: number }>>(
      'SELECT COALESCE(MAX(sort_order),0) AS s FROM shop_menus WHERE shop_id = ?', [shopId],
    );
    return Number(rows[0].s) + 1;
  }

  private async getOwned(shopId: number, id: number): Promise<{ image_url: string | null }> {
    const rows = await this.dataSource.query<Array<{ image_url: string | null }>>(
      'SELECT image_url FROM shop_menus WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบเมนูนี้');
    return rows[0];
  }

  private fileUrl(file: { filename: string } | undefined): string | null {
    if (!file) return null;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    return `${prefix}/${file.filename}`;
  }

  private async removeFile(url: string | null): Promise<void> {
    if (!url) return;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    if (!url.startsWith(`${prefix}/`)) return;
    const dir = this.config.get<string>('UPLOAD_DIR', './uploads');
    try { await unlink(join(dir, url.slice(prefix.length + 1))); }
    catch (err) { this.logger.warn(`could not delete ${url}: ${String(err)}`); }
  }
}
