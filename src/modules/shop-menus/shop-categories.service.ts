import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ShopCategory {
  id: number; templateId: number | null; name: string; nameEn: string | null;
  icon: string | null; sortOrder: number; isActive: boolean; menuCount: number;
}
export interface LibraryCategory { id: number; name: string; nameEn: string | null; icon: string | null; added: boolean }

@Injectable()
export class ShopCategoriesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(shopId: number): Promise<ShopCategory[]> {
    const rows = await this.dataSource.query<
      Array<Omit<ShopCategory, 'isActive'> & { isActive: number }>
    >(
      `SELECT c.id, c.template_id AS templateId, c.name, c.name_en AS nameEn, c.icon,
              c.sort_order AS sortOrder, c.is_active AS isActive,
              (SELECT COUNT(*) FROM shop_menus m WHERE m.category_id = c.id) AS menuCount
         FROM shop_foodcategories c
        WHERE c.shop_id = ?
        ORDER BY c.sort_order ASC, c.name ASC`,
      [shopId],
    );
    return rows.map((r) => ({ ...r, menuCount: Number(r.menuCount), isActive: Number(r.isActive) === 1 }));
  }

  // คลังกลาง (food_categories) + ธงว่าร้านนี้ดึงมาแล้วหรือยัง
  async library(shopId: number): Promise<LibraryCategory[]> {
    return this.dataSource.query<LibraryCategory[]>(
      `SELECT g.id, g.name, g.name_en AS nameEn, g.icon,
              EXISTS(SELECT 1 FROM shop_foodcategories s WHERE s.shop_id = ? AND s.template_id = g.id) AS added
         FROM food_categories g
        WHERE g.is_active = 1
        ORDER BY g.sort_order ASC, g.id ASC`,
      [shopId],
    );
  }

  async add(shopId: number, name: string, nameEn: string | null, icon: string | null): Promise<{ id: number }> {
    if (!name.trim()) throw new BadRequestException('กรุณากรอกชื่อหมวดหมู่');
    const sort = await this.nextSort(shopId);
    const res = await this.dataSource.query(
      `INSERT INTO shop_foodcategories (shop_id, template_id, name, name_en, icon, sort_order)
       VALUES (?, NULL, ?, ?, ?, ?)`,
      [shopId, name.trim(), nameEn || null, icon || null, sort],
    );
    return { id: Number((res as { insertId: number }).insertId) };
  }

  async update(shopId: number, id: number, name: string, nameEn: string | null, icon: string | null): Promise<void> {
    await this.getOwned(shopId, id);
    if (!name.trim()) throw new BadRequestException('กรุณากรอกชื่อหมวดหมู่');
    await this.dataSource.query(
      'UPDATE shop_foodcategories SET name = ?, name_en = ?, icon = ? WHERE id = ? AND shop_id = ?',
      [name.trim(), nameEn || null, icon || null, id, shopId],
    );
  }

  async remove(shopId: number, id: number): Promise<void> {
    await this.getOwned(shopId, id);
    const used = await this.dataSource.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM shop_menus WHERE category_id = ? AND shop_id = ?',
      [id, shopId],
    );
    if (Number(used[0].n) > 0) throw new BadRequestException('ลบไม่ได้ เพราะยังมีเมนูอยู่ในหมวดนี้');
    await this.dataSource.query('DELETE FROM shop_foodcategories WHERE id = ? AND shop_id = ?', [id, shopId]);
  }

  // ดึงหมวดจากคลังกลางทั้งหมด (ข้ามอันที่ดึงไปแล้ว)
  async syncFromGlobal(shopId: number): Promise<{ added: number }> {
    const res = await this.dataSource.query(
      `INSERT INTO shop_foodcategories (shop_id, template_id, name, name_en, icon, sort_order)
       SELECT ?, g.id, g.name, g.name_en, g.icon, g.sort_order
         FROM food_categories g
        WHERE g.is_active = 1
          AND NOT EXISTS (SELECT 1 FROM shop_foodcategories s WHERE s.shop_id = ? AND s.template_id = g.id)`,
      [shopId, shopId],
    );
    return { added: Number((res as { affectedRows?: number }).affectedRows ?? 0) };
  }

  // ใช้ภายใน: หา/สร้าง shop category จาก food_categories.id (สำหรับ clone template)
  async resolveFromTemplate(shopId: number, foodCategoryId: number): Promise<number> {
    const existing = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shop_foodcategories WHERE shop_id = ? AND template_id = ? LIMIT 1',
      [shopId, foodCategoryId],
    );
    if (existing[0]) return existing[0].id;
    const res = await this.dataSource.query(
      `INSERT INTO shop_foodcategories (shop_id, template_id, name, name_en, icon, sort_order)
       SELECT ?, id, name, name_en, icon, sort_order FROM food_categories WHERE id = ?`,
      [shopId, foodCategoryId],
    );
    return Number((res as { insertId: number }).insertId);
  }

  async assertOwned(shopId: number, id: number): Promise<void> { await this.getOwned(shopId, id); }

  private async getOwned(shopId: number, id: number): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shop_foodcategories WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบหมวดหมู่นี้');
  }

  private async nextSort(shopId: number): Promise<number> {
    const rows = await this.dataSource.query<Array<{ s: number }>>(
      'SELECT COALESCE(MAX(sort_order),0) AS s FROM shop_foodcategories WHERE shop_id = ?', [shopId],
    );
    return Number(rows[0].s) + 1;
  }
}
