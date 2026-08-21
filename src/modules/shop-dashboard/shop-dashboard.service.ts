import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DashboardSummary {
  salesToday: number;
  ordersToday: number;
  tablesInUse: number;
  tablesTotal: number;
  pendingOrders: number;
  totalMenus: number;
  onlineStaff: string[];
}

export interface BestSeller {
  menuId: number;
  name: string;
  imageUrl: string | null;
  qty: number;
  sales: number;
}

export type StatRange = 'today' | '7d' | 'month';

@Injectable()
export class ShopDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ช่วงเวลาแบบไทย (UTC+7) แปลงเป็นขอบเขต UTC เพื่อ query กับ datetime ที่เก็บเป็น UTC
  private thaiRange(range: StatRange): { start: string; end: string } {
    const OFF = 7 * 3600 * 1000;
    const now = Date.now();
    const thai = new Date(now + OFF);
    const y = thai.getUTCFullYear();
    const m = thai.getUTCMonth();
    const d = thai.getUTCDate();
    let startThai: number;
    if (range === 'today') startThai = Date.UTC(y, m, d, 0, 0, 0);
    else if (range === '7d') startThai = Date.UTC(y, m, d, 0, 0, 0) - 6 * 86400000;
    else startThai = Date.UTC(y, m, 1, 0, 0, 0);
    const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    return { start: fmt(startThai - OFF), end: fmt(now + 1000) };
  }

  async summary(shopId: number): Promise<DashboardSummary> {
    const { start, end } = this.thaiRange('today');

    const [sales] = await this.dataSource.query<Array<{ v: string | null }>>(
      `SELECT COALESCE(SUM(total), 0) AS v
         FROM bills
        WHERE shop_id = ? AND payment_status = 'paid' AND paid_at >= ? AND paid_at < ?`,
      [shopId, start, end],
    );
    const [orders] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(*) AS v FROM orders
        WHERE shop_id = ? AND status <> 'cancelled' AND created_at >= ? AND created_at < ?`,
      [shopId, start, end],
    );
    const [inUse] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(*) AS v FROM table_sessions
        WHERE shop_id = ? AND status = 'active' AND closed_at IS NULL`,
      [shopId],
    );
    const [tablesTotal] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(*) AS v FROM tables WHERE shop_id = ? AND is_active = 1`,
      [shopId],
    );
    const [pending] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(*) AS v FROM orders
        WHERE shop_id = ? AND status IN ('pending','confirmed','cooking')`,
      [shopId],
    );
    const [menus] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(*) AS v FROM shop_menus WHERE shop_id = ?`,
      [shopId],
    );

    let onlineStaff: string[] = [];
    try {
      const staffRows = await this.dataSource.query<Array<{ name: string }>>(
        `SELECT name FROM shop_staff
          WHERE shop_id = ? AND is_active = 1 AND last_seen_at >= NOW() - INTERVAL 5 MINUTE
          ORDER BY last_seen_at DESC`,
        [shopId],
      );
      onlineStaff = staffRows.map((r) => r.name);
    } catch {
      // คอลัมน์ last_seen_at ยังไม่มี -> คืนค่าว่าง
      onlineStaff = [];
    }

    return {
      salesToday: Number(sales?.v ?? 0),
      ordersToday: Number(orders?.v ?? 0),
      tablesInUse: Number(inUse?.v ?? 0),
      tablesTotal: Number(tablesTotal?.v ?? 0),
      pendingOrders: Number(pending?.v ?? 0),
      totalMenus: Number(menus?.v ?? 0),
      onlineStaff,
    };
  }

  async bestSellers(shopId: number, range: StatRange): Promise<BestSeller[]> {
    const { start, end } = this.thaiRange(range);
    const rows = await this.dataSource.query<
      Array<{ menuId: number; snapName: string; name: string | null; imageUrl: string | null; qty: string; sales: string }>
    >(
      `SELECT oi.menu_id AS menuId,
              oi.menu_name AS snapName,
              m.name AS name,
              m.image_url AS imageUrl,
              SUM(oi.quantity) AS qty,
              SUM(oi.subtotal) AS sales
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN shop_menus m ON m.id = oi.menu_id
        WHERE o.shop_id = ? AND o.status <> 'cancelled' AND oi.status <> 'cancelled'
          AND o.created_at >= ? AND o.created_at < ?
        GROUP BY oi.menu_id, oi.menu_name, m.name, m.image_url
        ORDER BY qty DESC, sales DESC
        LIMIT 6`,
      [shopId, start, end],
    );
    return rows.map((r) => ({
      menuId: r.menuId,
      name: r.name ?? r.snapName,
      imageUrl: r.imageUrl,
      qty: Number(r.qty),
      sales: Number(r.sales),
    }));
  }
}
