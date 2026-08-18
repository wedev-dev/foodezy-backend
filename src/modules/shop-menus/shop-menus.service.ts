import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { MenuDto } from './dto/menu.dto';

export interface Category { id: number; name: string; nameEn: string | null; icon: string | null }
export interface MenuRow {
  id: number; categoryId: number; categoryName: string; name: string; nameEn: string | null;
  description: string | null; price: number; imageUrl: string | null; isAvailable: boolean;
  isRecommended: boolean; sortOrder: number; menuPricingType: string;
}
export interface UploadedImage { image?: Array<{ filename: string }> }

@Injectable()
export class ShopMenusService {
  private readonly logger = new Logger(ShopMenusService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async list(shopId: number): Promise<{ categories: Category[]; menus: MenuRow[] }> {
    const categories = await this.dataSource.query<Category[]>(
      `SELECT id, name, name_en AS nameEn, icon
         FROM food_categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`,
    );
    const raw = await this.dataSource.query<
      Array<Omit<MenuRow, 'price' | 'isAvailable' | 'isRecommended'> & { price: string; isAvailable: number; isRecommended: number }>
    >(
      `SELECT m.id, m.category_id AS categoryId, c.name AS categoryName, m.name, m.name_en AS nameEn,
              m.description, m.price, m.image_url AS imageUrl, m.is_available AS isAvailable,
              m.is_recommended AS isRecommended, m.sort_order AS sortOrder, m.menu_pricing_type AS menuPricingType
         FROM shop_menus m
         JOIN food_categories c ON c.id = m.category_id
        WHERE m.shop_id = ?
        ORDER BY c.sort_order ASC, m.sort_order ASC, m.id ASC`,
      [shopId],
    );
    const menus: MenuRow[] = raw.map((r) => ({
      ...r,
      price: Number(r.price),
      isAvailable: Number(r.isAvailable) === 1,
      isRecommended: Number(r.isRecommended) === 1,
    }));
    return { categories, menus };
  }

  async create(shopId: number, dto: MenuDto, files: UploadedImage): Promise<{ id: number }> {
    await this.assertCategory(Number(dto.categoryId));
    const imageUrl = this.fileUrl(files.image?.[0]);
    const res = await this.dataSource.query(
      `INSERT INTO shop_menus
         (shop_id, category_id, name, name_en, description, price, image_url,
          is_available, is_recommended, sort_order, menu_pricing_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        Number(dto.categoryId),
        dto.name.trim(),
        dto.nameEn || null,
        dto.description || null,
        dto.price ? Number(dto.price) : 0,
        imageUrl,
        dto.isAvailable === '0' ? 0 : 1,
        dto.isRecommended === '1' ? 1 : 0,
        dto.sortOrder ? Number(dto.sortOrder) : 0,
        dto.menuPricingType ?? 'normal',
      ],
    );
    return { id: Number((res as { insertId: number }).insertId) };
  }

  async update(shopId: number, id: number, dto: MenuDto, files: UploadedImage): Promise<void> {
    const current = await this.getOwned(shopId, id);
    await this.assertCategory(Number(dto.categoryId));

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
        Number(dto.categoryId),
        dto.name.trim(),
        dto.nameEn || null,
        dto.description || null,
        dto.price ? Number(dto.price) : 0,
        imageUrl,
        dto.isAvailable === '0' ? 0 : 1,
        dto.isRecommended === '1' ? 1 : 0,
        dto.sortOrder ? Number(dto.sortOrder) : 0,
        dto.menuPricingType ?? 'normal',
        id,
        shopId,
      ],
    );
    await this.removeFile(toRemove);
  }

  async remove(shopId: number, id: number): Promise<void> {
    const current = await this.getOwned(shopId, id);
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

  private async getOwned(shopId: number, id: number): Promise<{ image_url: string | null }> {
    const rows = await this.dataSource.query<Array<{ image_url: string | null }>>(
      'SELECT image_url FROM shop_menus WHERE id = ? AND shop_id = ? LIMIT 1',
      [id, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบเมนูนี้');
    return rows[0];
  }

  private async assertCategory(categoryId: number): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM food_categories WHERE id = ? AND is_active = 1 LIMIT 1',
      [categoryId],
    );
    if (!rows[0]) throw new BadRequestException('หมวดหมู่ไม่ถูกต้อง');
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
