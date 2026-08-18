import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DashboardSummary {
  salesToday: number;
  ordersToday: number;
  tablesInUse: number;
  totalMenus: number;
}

@Injectable()
export class ShopDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async summary(shopId: number): Promise<DashboardSummary> {
    const [sales] = await this.dataSource.query<Array<{ v: string | null }>>(
      `SELECT COALESCE(SUM(oi.subtotal), 0) AS v
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
        WHERE o.shop_id = ? AND DATE(o.created_at) = CURDATE()
          AND o.status <> 'cancelled' AND oi.status <> 'cancelled'`,
      [shopId],
    );
    const [orders] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(*) AS v FROM orders
        WHERE shop_id = ? AND DATE(created_at) = CURDATE() AND status <> 'cancelled'`,
      [shopId],
    );
    const [inUse] = await this.dataSource.query<Array<{ v: number }>>(
      `SELECT COUNT(DISTINCT table_id) AS v FROM orders
        WHERE shop_id = ? AND status IN ('pending','confirmed','cooking','ready')`,
      [shopId],
    );
    const [menus] = await this.dataSource.query<Array<{ v: number }>>(
      'SELECT COUNT(*) AS v FROM shop_menus WHERE shop_id = ?',
      [shopId],
    );
    return {
      salesToday: Number(sales?.v ?? 0),
      ordersToday: Number(orders?.v ?? 0),
      tablesInUse: Number(inUse?.v ?? 0),
      totalMenus: Number(menus?.v ?? 0),
    };
  }
}
