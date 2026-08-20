import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type ReportRange = '7d' | '30d' | 'month';

export interface DailyPoint { date: string; sales: number; bills: number }
export interface MethodBreakdown { method: string; count: number; sales: number }
export interface TopMenu { menuId: number; name: string; qty: number; sales: number }
export interface BillRow { billNumber: string; tableNumber: string | null; total: number; method: string; paidAt: string }
export interface ReportData {
  range: ReportRange;
  totalSales: number;
  billCount: number;
  avgBill: number;
  itemsSold: number;
  daily: DailyPoint[];
  byMethod: MethodBreakdown[];
  topMenus: TopMenu[];
  bills: BillRow[];
}

@Injectable()
export class ShopReportsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ขอบเขตช่วงเวลาแบบไทย (UTC+7) -> UTC bounds + จำนวนวันของช่วง
  private range(range: ReportRange): { start: string; end: string; days: number } {
    const OFF = 7 * 3600 * 1000;
    const now = Date.now();
    const thai = new Date(now + OFF);
    const y = thai.getUTCFullYear();
    const m = thai.getUTCMonth();
    const d = thai.getUTCDate();
    const todayThai = Date.UTC(y, m, d, 0, 0, 0);
    let startThai: number;
    let days: number;
    if (range === '30d') { startThai = todayThai - 29 * 86400000; days = 30; }
    else if (range === 'month') { startThai = Date.UTC(y, m, 1, 0, 0, 0); days = d; }
    else { startThai = todayThai - 6 * 86400000; days = 7; }
    const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    return { start: fmt(startThai - OFF), end: fmt(now + 1000), days };
  }

  async report(shopId: number, range: ReportRange): Promise<ReportData> {
    const { start, end, days } = this.range(range);

    const [sum] = await this.dataSource.query<Array<{ billCount: number; totalSales: string }>>(
      `SELECT COUNT(*) AS billCount, COALESCE(SUM(total), 0) AS totalSales
         FROM bills
        WHERE shop_id = ? AND payment_status = 'paid' AND paid_at >= ? AND paid_at < ?`,
      [shopId, start, end],
    );
    const totalSales = Number(sum?.totalSales ?? 0);
    const billCount = Number(sum?.billCount ?? 0);

    const [items] = await this.dataSource.query<Array<{ v: string }>>(
      `SELECT COALESCE(SUM(oi.quantity), 0) AS v
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.shop_id = ? AND o.status <> 'cancelled' AND oi.status <> 'cancelled'
          AND o.created_at >= ? AND o.created_at < ?`,
      [shopId, start, end],
    );

    const byMethodRaw = await this.dataSource.query<Array<{ method: string; count: number; sales: string }>>(
      `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS sales
         FROM bills
        WHERE shop_id = ? AND payment_status = 'paid' AND paid_at >= ? AND paid_at < ?
        GROUP BY payment_method`,
      [shopId, start, end],
    );

    const dailyRaw = await this.dataSource.query<Array<{ d: string; sales: string; bills: number }>>(
      `SELECT DATE(CONVERT_TZ(paid_at, '+00:00', '+07:00')) AS d,
              COALESCE(SUM(total), 0) AS sales, COUNT(*) AS bills
         FROM bills
        WHERE shop_id = ? AND payment_status = 'paid' AND paid_at >= ? AND paid_at < ?
        GROUP BY d ORDER BY d ASC`,
      [shopId, start, end],
    );

    const topRaw = await this.dataSource.query<Array<{ menuId: number; name: string; qty: string; sales: string }>>(
      `SELECT oi.menu_id AS menuId, COALESCE(m.name, oi.menu_name) AS name,
              SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS sales
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN shop_menus m ON m.id = oi.menu_id
        WHERE o.shop_id = ? AND o.status <> 'cancelled' AND oi.status <> 'cancelled'
          AND o.created_at >= ? AND o.created_at < ?
        GROUP BY oi.menu_id, name ORDER BY qty DESC, sales DESC LIMIT 10`,
      [shopId, start, end],
    );

    const billRaw = await this.dataSource.query<
      Array<{ billNumber: string; tableNumber: string | null; total: string; method: string; paidAt: string }>
    >(
      `SELECT b.bill_number AS billNumber, t.table_number AS tableNumber,
              b.total, b.payment_method AS method, b.paid_at AS paidAt
         FROM bills b
         LEFT JOIN table_sessions ts ON ts.id = b.session_id
         LEFT JOIN tables t ON t.id = ts.table_id
        WHERE b.shop_id = ? AND b.payment_status = 'paid' AND b.paid_at >= ? AND b.paid_at < ?
        ORDER BY b.paid_at DESC LIMIT 50`,
      [shopId, start, end],
    );

    return {
      range,
      totalSales,
      billCount,
      avgBill: billCount > 0 ? Math.round((totalSales / billCount) * 100) / 100 : 0,
      itemsSold: Number(items?.v ?? 0),
      daily: this.fillDaily(dailyRaw, days),
      byMethod: byMethodRaw.map((r) => ({ method: r.method, count: Number(r.count), sales: Number(r.sales) })),
      topMenus: topRaw.map((r) => ({ menuId: r.menuId, name: r.name, qty: Number(r.qty), sales: Number(r.sales) })),
      bills: billRaw.map((r) => ({
        billNumber: r.billNumber,
        tableNumber: r.tableNumber,
        total: Number(r.total),
        method: r.method,
        paidAt: r.paidAt,
      })),
    };
  }

  // เติมวันที่ที่ไม่มียอดให้เป็น 0 เพื่อกราฟต่อเนื่อง (อิงวันที่แบบไทย)
  private fillDaily(rows: Array<{ d: string; sales: string; bills: number }>, days: number): DailyPoint[] {
    const map = new Map(rows.map((r) => [String(r.d).slice(0, 10), { sales: Number(r.sales), bills: Number(r.bills) }]));
    const OFF = 7 * 3600 * 1000;
    const thai = new Date(Date.now() + OFF);
    const y = thai.getUTCFullYear();
    const m = thai.getUTCMonth();
    const d = thai.getUTCDate();
    const out: DailyPoint[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const dayMs = Date.UTC(y, m, d - i, 0, 0, 0);
      const key = new Date(dayMs).toISOString().slice(0, 10);
      const hit = map.get(key);
      out.push({ date: key, sales: hit?.sales ?? 0, bills: hit?.bills ?? 0 });
    }
    return out;
  }
}
