import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';

export interface BillRow {
  id: number;
  shopId: number;
  shopName: string;
  shopCode: string;
  packageId: number;
  packageName: string | null;
  amount: string;
  billingMonth: string;
  slipUrl: string | null;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface BillingHistoryPage {
  rows: BillRow[];
  total: number;
  page: number;
  totalPages: number;
  stats: { totalRevenue: string; approvedCount: number; rejectedCount: number };
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

const PAGE_SIZE = 30;
/** Every approved payment buys the same window the legacy page granted. */
const EXTENSION_DAYS = 30;

@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async listPending(): Promise<BillRow[]> {
    return this.dataSource.query<BillRow[]>(
      `${this.selectSql()}
        WHERE b.status = 'pending' AND b.amount > 0
        ORDER BY b.created_at ASC`,
    );
  }

  async history(page = 1): Promise<BillingHistoryPage> {
    const current = page > 0 ? page : 1;
    const offset = (current - 1) * PAGE_SIZE;
    const where = "(b.status IN ('approved', 'rejected') OR b.approved_at IS NOT NULL)";

    const [countRows, rows, revenue, approved, rejected] = await Promise.all([
      this.dataSource.query<Array<{ c: string }>>(
        `SELECT COUNT(*) AS c FROM shop_billing_history b WHERE ${where}`,
      ),
      this.dataSource.query<BillRow[]>(
        `${this.selectSql()}
          WHERE ${where}
          ORDER BY COALESCE(b.approved_at, b.created_at) DESC
          LIMIT ? OFFSET ?`,
        [PAGE_SIZE, offset],
      ),
      this.scalar(
        "SELECT COALESCE(SUM(amount), 0) AS c FROM shop_billing_history WHERE status = 'approved'",
      ),
      this.scalar(
        "SELECT COUNT(*) AS c FROM shop_billing_history WHERE status = 'approved' OR (amount = 0 AND approved_at IS NOT NULL)",
      ),
      this.scalar("SELECT COUNT(*) AS c FROM shop_billing_history WHERE status = 'rejected'"),
    ]);

    const total = Number(countRows[0]?.c ?? 0);

    return {
      rows,
      total,
      page: current,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      stats: {
        totalRevenue: revenue,
        approvedCount: Number(approved),
        rejectedCount: Number(rejected),
      },
    };
  }

  /**
   * shop_id and package_id come from the stored bill, never from the request:
   * the legacy page trusted hidden form fields, so a tampered POST could grant
   * a different shop a different package.
   */
  async approve(billId: number, actor: ActorMeta): Promise<{ shopName: string }> {
    const bill = await this.loadPendingBill(billId);

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + EXTENSION_DAYS);
    endDate.setHours(23, 59, 59, 0);
    const endSql = this.mysqlDate(endDate);

    await this.dataSource.transaction(async (trx) => {
      await trx.query(
        `UPDATE shop_billing_history
            SET status = 'approved', approved_by = ?, approved_at = NOW()
          WHERE id = ?`,
        [actor.adminId, billId],
      );

      await trx.query(
        `UPDATE shops
            SET package_id = ?, status = 'active',
                package_start_at = NOW(), package_end_at = ?, updated_at = NOW()
          WHERE id = ?`,
        [bill.packageId, endSql, bill.shopId],
      );
    });

    await this.writeLog(
      actor,
      'billing.approve',
      billId,
      JSON.stringify({ shop_id: bill.shopId, package_id: bill.packageId, package_end_at: endSql }),
    );

    return { shopName: bill.shopName };
  }

  async reject(billId: number, note: string, actor: ActorMeta): Promise<void> {
    await this.loadPendingBill(billId);

    await this.dataSource.query(
      `UPDATE shop_billing_history
          SET status = 'rejected', note = ?, approved_by = ?, approved_at = NOW()
        WHERE id = ?`,
      [note, actor.adminId, billId],
    );

    await this.writeLog(
      actor,
      'billing.reject',
      billId,
      JSON.stringify({ status: 'rejected', reason: note }),
    );
  }

  /** Guards against approving the same slip twice from two open tabs. */
  private async loadPendingBill(
    billId: number,
  ): Promise<{ shopId: number; packageId: number; shopName: string }> {
    const rows = await this.dataSource.query<
      Array<{ shopId: number; packageId: number; shopName: string; status: string }>
    >(
      `SELECT b.shop_id AS shopId, b.package_id AS packageId, s.name AS shopName, b.status AS status
         FROM shop_billing_history b
         JOIN shops s ON b.shop_id = s.id
        WHERE b.id = ?`,
      [billId],
    );

    const bill = rows[0];
    if (!bill) throw new NotFoundException('ไม่พบรายการชำระเงินนี้');
    if (bill.status !== 'pending') {
      throw new NotFoundException('รายการนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ');
    }

    return { shopId: Number(bill.shopId), packageId: Number(bill.packageId), shopName: bill.shopName };
  }

  private selectSql(): string {
    return `
      SELECT b.id            AS id,
             b.shop_id       AS shopId,
             s.name          AS shopName,
             s.shop_code     AS shopCode,
             b.package_id    AS packageId,
             p.name          AS packageName,
             b.amount        AS amount,
             b.billing_month AS billingMonth,
             b.slip_url      AS slipUrl,
             b.status        AS status,
             b.note          AS note,
             ad.admin_name   AS approvedByName,
             b.approved_at   AS approvedAt,
             b.created_at    AS createdAt
        FROM shop_billing_history b
        JOIN shops s ON b.shop_id = s.id
        LEFT JOIN packages p ON b.package_id = p.id
        LEFT JOIN admintb ad ON b.approved_by = ad.admin_id`;
  }

  private async scalar(sql: string): Promise<string> {
    try {
      const rows = await this.dataSource.query<Array<{ c: string | number }>>(sql);
      return String(rows[0]?.c ?? 0);
    } catch (err) {
      this.logger.warn(`billing stat failed: ${String(err)}`);
      return '0';
    }
  }

  private mysqlDate(d: Date): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private async writeLog(
    actor: ActorMeta,
    action: string,
    targetId: number,
    newValue: string,
  ): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: actor.adminId,
          action,
          targetType: 'shop_billing_history',
          targetId,
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
