import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface PendingShop {
  id: number;
  name: string;
  createdAt: string;
  pkgName: string | null;
}

export interface BellItem {
  type: string;
  msg: string;
  createdAt: string;
}

export interface ShopSearchItem {
  id: number;
  name: string;
  code: string;
  status: string;
}

export interface DashboardData {
  totalShops: number;
  activeShops: number;
  ordersToday: number;
  pendingShops: number;
  revenueMonth: number;
  menuTemplates: number;
  optionGroups: number;
  pkgTrial: number;
  pkgPro: number;
  pendingList: PendingShop[];
  bellItems: BellItem[];
  shops: ShopSearchItem[];
}

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getDashboard(): Promise<DashboardData> {
    const [
      totalShops,
      activeShops,
      ordersToday,
      pendingShops,
      revenueMonth,
      menuTemplates,
      optionGroups,
      pkgTrial,
      pkgPro,
      pendingList,
      bellItems,
      shops,
    ] = await Promise.all([
      this.count('SELECT COUNT(*) AS c FROM shops WHERE deleted_at IS NULL'),
      this.count(
        "SELECT COUNT(*) AS c FROM shops WHERE status = 'active' AND deleted_at IS NULL",
      ),
      this.count('SELECT COUNT(*) AS c FROM orders WHERE DATE(created_at) = CURDATE()'),
      this.count(
        "SELECT COUNT(*) AS c FROM shops WHERE status = 'pending' AND deleted_at IS NULL",
      ),
      this.count(
        `SELECT COALESCE(SUM(amount), 0) AS c FROM shop_billing_history
         WHERE status = 'approved'
           AND MONTH(billing_month) = MONTH(CURDATE())
           AND YEAR(billing_month) = YEAR(CURDATE())`,
      ),
      this.count('SELECT COUNT(*) AS c FROM menu_templates WHERE is_active = 1'),
      this.count('SELECT COUNT(*) AS c FROM global_option_groups WHERE is_active = 1'),
      this.count(
        `SELECT COUNT(*) AS c FROM shops s JOIN packages p ON s.package_id = p.id
         WHERE p.name = 'Trial' AND s.status = 'active' AND s.deleted_at IS NULL`,
      ),
      this.count(
        `SELECT COUNT(*) AS c FROM shops s JOIN packages p ON s.package_id = p.id
         WHERE p.name IN ('Pro', 'Premium') AND s.status = 'active' AND s.deleted_at IS NULL`,
      ),
      this.rows<PendingShop>(
        `SELECT s.id AS id, s.name AS name, s.created_at AS createdAt, p.name AS pkgName
         FROM shops s LEFT JOIN packages p ON s.package_id = p.id
         WHERE s.status = 'pending' AND s.deleted_at IS NULL
         ORDER BY s.created_at DESC LIMIT 5`,
      ),
      this.rows<BellItem>(
        `SELECT 'ร้านใหม่รออนุมัติ' AS type,
                CONCAT('ร้าน ', name, ' รอการตรวจสอบ') AS msg,
                created_at AS createdAt
           FROM shops WHERE status = 'pending' AND deleted_at IS NULL
         UNION ALL
         SELECT 'แจ้งชำระเงิน' AS type,
                CONCAT(s.name, ' — ฿', b.amount) AS msg,
                b.created_at AS createdAt
           FROM shop_billing_history b JOIN shops s ON b.shop_id = s.id
          WHERE b.status = 'pending' AND s.deleted_at IS NULL
         ORDER BY createdAt DESC LIMIT 8`,
      ),
      this.rows<ShopSearchItem>(
        `SELECT id, name, shop_code AS code, status
         FROM shops WHERE deleted_at IS NULL ORDER BY name`,
      ),
    ]);

    return {
      totalShops,
      activeShops,
      ordersToday,
      pendingShops,
      revenueMonth,
      menuTemplates,
      optionGroups,
      pkgTrial,
      pkgPro,
      pendingList,
      bellItems,
      shops,
    };
  }

  /**
   * Each tile is independent: one failing query (missing table, bad data)
   * should blank that number, not take down the whole dashboard —
   * the legacy PHP zeroed every counter when any query threw.
   */
  private async count(sql: string): Promise<number> {
    try {
      const rows = await this.dataSource.query<Array<{ c: string | number }>>(sql);
      return Number(rows[0]?.c ?? 0);
    } catch (err) {
      this.logger.warn(`dashboard count failed: ${String(err)}`);
      return 0;
    }
  }

  private async rows<T>(sql: string): Promise<T[]> {
    try {
      return await this.dataSource.query<T[]>(sql);
    } catch (err) {
      this.logger.warn(`dashboard rows failed: ${String(err)}`);
      return [];
    }
  }
}
