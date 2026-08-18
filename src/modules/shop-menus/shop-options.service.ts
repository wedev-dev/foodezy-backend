import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OptionGroupDto } from './dto/option.dto';

export interface OptionItem { id: number; name: string; priceAdjustment: number; sortOrder: number }
export interface OptionGroup {
  id: number; sourceGlobalGroupId: number | null; name: string;
  selectionType: 'single' | 'multiple'; isRequired: boolean;
  minSelect: number; maxSelect: number; sortOrder: number; items: OptionItem[];
}
export interface LibraryGroup {
  id: number; name: string; selectionType: string; itemCount: number; added: boolean;
}

@Injectable()
export class ShopOptionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(shopId: number): Promise<OptionGroup[]> {
    const groups = await this.dataSource.query<
      Array<Omit<OptionGroup, 'isRequired' | 'items'> & { isRequired: number }>
    >(
      `SELECT id, source_global_group_id AS sourceGlobalGroupId, name, selection_type AS selectionType,
              is_required AS isRequired, min_select AS minSelect, max_select AS maxSelect, sort_order AS sortOrder
         FROM shop_option_groups WHERE shop_id = ? ORDER BY sort_order ASC, id ASC`,
      [shopId],
    );
    if (!groups.length) return [];
    const ids = groups.map((g) => g.id);
    const items = await this.dataSource.query<Array<OptionItem & { groupId: number; priceAdjustment: string }>>(
      `SELECT id, shop_option_group_id AS groupId, name, price_adjustment AS priceAdjustment, sort_order AS sortOrder
         FROM shop_option_items WHERE shop_option_group_id IN (${ids.map(() => '?').join(',')})
        ORDER BY sort_order ASC, id ASC`,
      ids,
    );
    return groups.map((g) => ({
      ...g,
      isRequired: Number(g.isRequired) === 1,
      minSelect: Number(g.minSelect),
      maxSelect: Number(g.maxSelect),
      items: items.filter((it) => it.groupId === g.id).map((it) => ({
        id: it.id, name: it.name, priceAdjustment: Number(it.priceAdjustment), sortOrder: it.sortOrder,
      })),
    }));
  }

  async create(shopId: number, dto: OptionGroupDto): Promise<{ id: number }> {
    const sort = await this.nextSort(shopId);
    const res = await this.dataSource.query(
      `INSERT INTO shop_option_groups
         (shop_id, name, selection_type, is_required, min_select, max_select, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId, dto.name.trim(), dto.selectionType, dto.isRequired ? 1 : 0,
        dto.minSelect ?? 0, dto.maxSelect ?? 0, sort,
      ],
    );
    const groupId = Number((res as { insertId: number }).insertId);
    await this.insertItems(groupId, dto);
    return { id: groupId };
  }

  async update(shopId: number, id: number, dto: OptionGroupDto): Promise<void> {
    await this.getOwned(shopId, id);
    await this.dataSource.query(
      `UPDATE shop_option_groups SET name = ?, selection_type = ?, is_required = ?, min_select = ?, max_select = ?
       WHERE id = ? AND shop_id = ?`,
      [dto.name.trim(), dto.selectionType, dto.isRequired ? 1 : 0, dto.minSelect ?? 0, dto.maxSelect ?? 0, id, shopId],
    );
    await this.dataSource.query('DELETE FROM shop_option_items WHERE shop_option_group_id = ?', [id]);
    await this.insertItems(id, dto);
  }

  async remove(shopId: number, id: number): Promise<void> {
    await this.getOwned(shopId, id);
    await this.dataSource.query('DELETE FROM menu_option_groups WHERE shop_option_group_id = ?', [id]);
    await this.dataSource.query('DELETE FROM shop_option_items WHERE shop_option_group_id = ?', [id]);
    await this.dataSource.query('DELETE FROM shop_option_groups WHERE id = ? AND shop_id = ?', [id, shopId]);
  }

  async library(shopId: number): Promise<LibraryGroup[]> {
    const rows = await this.dataSource.query<Array<Omit<LibraryGroup, 'added' | 'itemCount'> & { added: number; itemCount: number }>>(
      `SELECT g.id, g.name, g.default_selection_type AS selectionType,
              (SELECT COUNT(*) FROM global_option_items i WHERE i.global_option_group_id = g.id AND i.is_active = 1) AS itemCount,
              EXISTS(SELECT 1 FROM shop_option_groups s WHERE s.shop_id = ? AND s.source_global_group_id = g.id) AS added
         FROM global_option_groups g
        WHERE g.is_active = 1
        ORDER BY g.sort_order ASC, g.id ASC`,
      [shopId],
    );
    return rows.map((r) => ({ ...r, itemCount: Number(r.itemCount), added: Number(r.added) === 1 }));
  }

  // clone กลุ่มออฟชั่นจากคลังกลาง (is_required = 0 เสมอ) — ข้ามที่ดึงแล้ว
  async syncFromGlobal(shopId: number, groupIds: number[] | null): Promise<{ added: number }> {
    const lib = await this.library(shopId);
    const targets = lib.filter((g) => !g.added && (groupIds === null || groupIds.includes(g.id)));
    let added = 0;
    for (const g of targets) {
      const created = await this.cloneOneGlobal(shopId, g.id);
      if (created) added += 1;
    }
    return { added };
  }

  // หา/สร้าง shop_option_group จาก global (คืน id) — ใช้ตอน clone เมนูต้นแบบให้ผูกออฟชั่นอัตโนมัติ
  async resolveGlobalGroup(shopId: number, globalGroupId: number): Promise<number | null> {
    const existing = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shop_option_groups WHERE shop_id = ? AND source_global_group_id = ? LIMIT 1',
      [shopId, globalGroupId],
    );
    if (existing[0]) return existing[0].id;
    return this.cloneOneGlobal(shopId, globalGroupId);
  }

  // clone กลุ่ม global 1 กลุ่ม (+ items) เข้าร้าน is_required=0 — คืน id ใหม่ (null ถ้าไม่พบ global)
  private async cloneOneGlobal(shopId: number, globalGroupId: number): Promise<number | null> {
    const gRow = await this.dataSource.query<Array<{ name: string; sel: string; sort: number }>>(
      'SELECT name, default_selection_type AS sel, sort_order AS sort FROM global_option_groups WHERE id = ? LIMIT 1',
      [globalGroupId],
    );
    if (!gRow[0]) return null;
    const res = await this.dataSource.query(
      `INSERT INTO shop_option_groups (shop_id, source_global_group_id, name, selection_type, is_required, sort_order)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [shopId, globalGroupId, gRow[0].name, gRow[0].sel, gRow[0].sort],
    );
    const newGroupId = Number((res as { insertId: number }).insertId);
    await this.dataSource.query(
      `INSERT INTO shop_option_items (shop_option_group_id, name, price_adjustment, sort_order)
       SELECT ?, name, default_extra_price, sort_order
         FROM global_option_items WHERE global_option_group_id = ? AND is_active = 1
        ORDER BY sort_order ASC`,
      [newGroupId, globalGroupId],
    );
    return newGroupId;
  }

  private async insertItems(groupId: number, dto: OptionGroupDto): Promise<void> {
    let i = 0;
    for (const it of dto.items) {
      if (!it.name.trim()) throw new BadRequestException('ชื่อตัวเลือกห้ามว่าง');
      await this.dataSource.query(
        `INSERT INTO shop_option_items (shop_option_group_id, name, price_adjustment, sort_order)
         VALUES (?, ?, ?, ?)`,
        [groupId, it.name.trim(), it.priceAdjustment ?? 0, i],
      );
      i += 1;
    }
  }

  private async getOwned(shopId: number, id: number): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shop_option_groups WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบกลุ่มตัวเลือกนี้');
  }

  private async nextSort(shopId: number): Promise<number> {
    const rows = await this.dataSource.query<Array<{ s: number }>>(
      'SELECT COALESCE(MAX(sort_order),0) AS s FROM shop_option_groups WHERE shop_id = ?', [shopId],
    );
    return Number(rows[0].s) + 1;
  }
}
