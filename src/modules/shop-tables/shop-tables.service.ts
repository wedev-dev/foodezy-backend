import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TableDto } from './dto/table.dto';

export interface TableRow {
  id: number; tableNumber: string; qrToken: string; seats: number; isActive: boolean;
}

@Injectable()
export class ShopTablesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(shopId: number): Promise<TableRow[]> {
    const rows = await this.dataSource.query<Array<Omit<TableRow, 'isActive'> & { isActive: number }>>(
      `SELECT id, table_number AS tableNumber, qr_token AS qrToken, seats, is_active AS isActive
         FROM tables WHERE shop_id = ?
        ORDER BY (table_number REGEXP '^[0-9]+$') DESC, CAST(table_number AS UNSIGNED) ASC, table_number ASC`,
      [shopId],
    );
    return rows.map((r) => ({ ...r, seats: Number(r.seats), isActive: Number(r.isActive) === 1 }));
  }

  async create(shopId: number, dto: TableDto): Promise<{ id: number; tableNumber: string; qrToken: string }> {
    // เช็คลิมิตจำนวนโต๊ะตามแพ็กเกจก่อนเพิ่ม
    const limitRows = await this.dataSource.query<Array<{ maxTables: number | null; used: number }>>(
      `SELECT p.max_tables AS maxTables,
              (SELECT COUNT(*) FROM tables t WHERE t.shop_id = s.id) AS used
         FROM shops s
         LEFT JOIN packages p ON p.id = s.package_id
        WHERE s.id = ?`,
      [shopId],
    );
    const maxTables = limitRows[0]?.maxTables != null ? Number(limitRows[0].maxTables) : null;
    const used = Number(limitRows[0]?.used ?? 0);
    if (maxTables != null && maxTables > 0 && used >= maxTables) {
      throw new BadRequestException(
        `แพ็กเกจของคุณเพิ่มโต๊ะได้สูงสุด ${maxTables} โต๊ะ (ตอนนี้มี ${used} โต๊ะแล้ว) — กรุณาอัปเกรดแพ็กเกจเพื่อเพิ่มโต๊ะ`,
      );
    }
    const number = dto.tableNumber?.trim() || (await this.nextNumber(shopId));
    await this.assertUniqueNumber(shopId, number);
    const token = await this.newToken();
    const seats = dto.seats ? Number(dto.seats) : 4;
    const res = await this.dataSource.query(
      `INSERT INTO tables (shop_id, table_number, qr_token, seats, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [shopId, number, token, seats],
    );
    return { id: Number((res as { insertId: number }).insertId), tableNumber: number, qrToken: token };
  }

  async update(shopId: number, id: number, dto: TableDto): Promise<void> {
    const cur = await this.getOwned(shopId, id);
    const number = dto.tableNumber?.trim() || cur.table_number;
    if (number !== cur.table_number) await this.assertUniqueNumber(shopId, number);
    const seats = dto.seats ? Number(dto.seats) : cur.seats;
    await this.dataSource.query(
      'UPDATE tables SET table_number = ?, seats = ? WHERE id = ? AND shop_id = ?',
      [number, seats, id, shopId],
    );
  }

  async toggleActive(shopId: number, id: number): Promise<{ isActive: boolean }> {
    await this.getOwned(shopId, id);
    await this.dataSource.query(
      'UPDATE tables SET is_active = 1 - is_active WHERE id = ? AND shop_id = ?',
      [id, shopId],
    );
    const row = await this.dataSource.query<Array<{ is_active: number }>>(
      'SELECT is_active FROM tables WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    return { isActive: Number(row[0].is_active) === 1 };
  }

  async regenerateToken(shopId: number, id: number): Promise<{ qrToken: string }> {
    await this.getOwned(shopId, id);
    const token = await this.newToken();
    await this.dataSource.query(
      'UPDATE tables SET qr_token = ? WHERE id = ? AND shop_id = ?', [token, id, shopId],
    );
    return { qrToken: token };
  }

  async remove(shopId: number, id: number): Promise<void> {
    await this.getOwned(shopId, id);
    await this.dataSource.query('DELETE FROM tables WHERE id = ? AND shop_id = ?', [id, shopId]);
  }

  private async getOwned(shopId: number, id: number): Promise<{ table_number: string; seats: number }> {
    const rows = await this.dataSource.query<Array<{ table_number: string; seats: number }>>(
      'SELECT table_number, seats FROM tables WHERE id = ? AND shop_id = ? LIMIT 1', [id, shopId],
    );
    if (!rows[0]) throw new NotFoundException('ไม่พบโต๊ะนี้');
    return rows[0];
  }

  private async assertUniqueNumber(shopId: number, number: string): Promise<void> {
    const rows = await this.dataSource.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM tables WHERE shop_id = ? AND table_number = ?', [shopId, number],
    );
    if (Number(rows[0].n) > 0) throw new BadRequestException(`มีโต๊ะหมายเลข "${number}" อยู่แล้ว`);
  }

  private async nextNumber(shopId: number): Promise<string> {
    const rows = await this.dataSource.query<Array<{ mx: number | null }>>(
      `SELECT MAX(CAST(table_number AS UNSIGNED)) AS mx
         FROM tables WHERE shop_id = ? AND table_number REGEXP '^[0-9]+$'`,
      [shopId],
    );
    return String((Number(rows[0]?.mx) || 0) + 1);
  }

  private async newToken(): Promise<string> {
    for (let i = 0; i < 8; i += 1) {
      const token = `qrtk_${randomBytes(16).toString('hex')}`;
      const rows = await this.dataSource.query<Array<{ n: number }>>(
        'SELECT COUNT(*) AS n FROM tables WHERE qr_token = ?', [token],
      );
      if (Number(rows[0].n) === 0) return token;
    }
    throw new BadRequestException('สร้าง token ไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
}
