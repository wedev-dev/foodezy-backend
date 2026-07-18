import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { CreateExpenseDto } from './dto/create-expense.dto';

export interface ExpenseRow {
  id: number;
  category: string;
  description: string | null;
  amount: string;
  expenseDate: string;
  createdAt: string;
}

export interface RevenueReport {
  month: string;
  totalIncome: string;
  totalExpense: string;
  netProfit: string;
  expenses: ExpenseRow[];
  incomeByPackage: Array<{ packageName: string; billCount: number; total: string }>;
  expenseByCategory: Array<{ category: string; total: string }>;
}

export interface PlatformStats {
  platRevMonth: string;
  platRevTotal: string;
  gmvMonth: string;
  gmvTotal: string;
  ordersToday: number;
  ordersMonth: number;
  totalShops: number;
  activeShops: number;
  topShops: Array<{ name: string; shopCode: string; orderCount: number; totalSales: string }>;
  packageStats: Array<{ name: string; shopCount: number }>;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminFinanceService {
  private readonly logger = new Logger(AdminFinanceService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async revenue(month: string | undefined): Promise<RevenueReport> {
    const target = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : this.currentMonth();
    const start = `${target}-01`;
    const end = this.lastDayOf(target);

    const [income, expense, expenses, byPackage, byCategory] = await Promise.all([
      this.scalar(
        `SELECT COALESCE(SUM(amount), 0) AS c FROM shop_billing_history
          WHERE status = 'approved' AND billing_month BETWEEN ? AND ?`,
        [start, end],
      ),
      this.scalar(
        'SELECT COALESCE(SUM(amount), 0) AS c FROM platform_expenses WHERE expense_date BETWEEN ? AND ?',
        [start, end],
      ),
      this.rows<ExpenseRow>(
        `SELECT id, category, description, amount,
                expense_date AS expenseDate, created_at AS createdAt
           FROM platform_expenses
          WHERE expense_date BETWEEN ? AND ?
          ORDER BY expense_date DESC, id DESC`,
        [start, end],
      ),
      this.rows<{ packageName: string; billCount: number; total: string }>(
        `SELECT p.name AS packageName, COUNT(*) AS billCount, COALESCE(SUM(b.amount), 0) AS total
           FROM shop_billing_history b
           JOIN packages p ON b.package_id = p.id
          WHERE b.status = 'approved' AND b.billing_month BETWEEN ? AND ?
          GROUP BY p.id, p.name
          ORDER BY total DESC`,
        [start, end],
      ),
      this.rows<{ category: string; total: string }>(
        `SELECT category, COALESCE(SUM(amount), 0) AS total
           FROM platform_expenses
          WHERE expense_date BETWEEN ? AND ?
          GROUP BY category
          ORDER BY total DESC`,
        [start, end],
      ),
    ]);

    return {
      month: target,
      totalIncome: income,
      totalExpense: expense,
      netProfit: String(Number(income) - Number(expense)),
      expenses,
      incomeByPackage: byPackage,
      expenseByCategory: byCategory,
    };
  }

  async addExpense(dto: CreateExpenseDto, actor: ActorMeta): Promise<number> {
    // platform_expenses has no created_by column — the legacy page tried to
    // insert one, which is why saving an expense always failed. The admin is
    // recorded in audit_logs instead.
    const result = await this.dataSource.query<{ insertId: number }>(
      `INSERT INTO platform_expenses (category, description, amount, expense_date, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [dto.category, dto.description || null, dto.amount, dto.expenseDate],
    );

    const id = Number(result.insertId);
    await this.writeLog(
      actor,
      'system.expense_create',
      id,
      JSON.stringify({ category: dto.category, amount: dto.amount, date: dto.expenseDate }),
    );
    return id;
  }

  async removeExpense(id: number, actor: ActorMeta): Promise<void> {
    const result = await this.dataSource.query<{ affectedRows?: number }>(
      'DELETE FROM platform_expenses WHERE id = ?',
      [id],
    );
    if (result?.affectedRows === 0) throw new NotFoundException('ไม่พบรายการรายจ่ายนี้');

    await this.writeLog(actor, 'system.expense_delete', id, JSON.stringify({ deleted: true }));
  }

  async platformStats(): Promise<PlatformStats> {
    const [
      platRevMonth,
      platRevTotal,
      gmvMonth,
      gmvTotal,
      ordersToday,
      ordersMonth,
      totalShops,
      activeShops,
      topShops,
      packageStats,
    ] = await Promise.all([
      this.scalar(
        `SELECT COALESCE(SUM(amount), 0) AS c FROM shop_billing_history
          WHERE status = 'approved'
            AND MONTH(approved_at) = MONTH(CURRENT_DATE())
            AND YEAR(approved_at) = YEAR(CURRENT_DATE())`,
      ),
      this.scalar(
        "SELECT COALESCE(SUM(amount), 0) AS c FROM shop_billing_history WHERE status = 'approved'",
      ),
      this.scalar(
        `SELECT COALESCE(SUM(total), 0) AS c FROM bills
          WHERE payment_status = 'paid'
            AND MONTH(paid_at) = MONTH(CURRENT_DATE())
            AND YEAR(paid_at) = YEAR(CURRENT_DATE())`,
      ),
      this.scalar("SELECT COALESCE(SUM(total), 0) AS c FROM bills WHERE payment_status = 'paid'"),
      this.scalar('SELECT COUNT(*) AS c FROM orders WHERE DATE(created_at) = CURRENT_DATE()'),
      this.scalar(
        `SELECT COUNT(*) AS c FROM orders
          WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
            AND YEAR(created_at) = YEAR(CURRENT_DATE())`,
      ),
      this.scalar('SELECT COUNT(*) AS c FROM shops WHERE deleted_at IS NULL'),
      this.scalar("SELECT COUNT(*) AS c FROM shops WHERE status = 'active' AND deleted_at IS NULL"),
      // The legacy version ran two correlated subqueries per shop across the
      // whole table before sorting; grouped joins do the same work once.
      this.rows<{ name: string; shopCode: string; orderCount: number; totalSales: string }>(
        `SELECT s.name AS name,
                s.shop_code AS shopCode,
                COALESCE(o.order_count, 0) AS orderCount,
                COALESCE(b.total_sales, 0) AS totalSales
           FROM shops s
           LEFT JOIN (
             SELECT shop_id, COUNT(*) AS order_count FROM orders GROUP BY shop_id
           ) o ON o.shop_id = s.id
           LEFT JOIN (
             SELECT shop_id, SUM(total) AS total_sales FROM bills
              WHERE payment_status = 'paid' GROUP BY shop_id
           ) b ON b.shop_id = s.id
          WHERE s.deleted_at IS NULL AND s.status = 'active'
          ORDER BY totalSales DESC
          LIMIT 5`,
      ),
      this.rows<{ name: string; shopCount: number }>(
        `SELECT p.name AS name, COUNT(s.id) AS shopCount
           FROM packages p
           LEFT JOIN shops s ON s.package_id = p.id AND s.deleted_at IS NULL AND s.status = 'active'
          GROUP BY p.id, p.name
          ORDER BY shopCount DESC`,
      ),
    ]);

    return {
      platRevMonth,
      platRevTotal,
      gmvMonth,
      gmvTotal,
      ordersToday: Number(ordersToday),
      ordersMonth: Number(ordersMonth),
      totalShops: Number(totalShops),
      activeShops: Number(activeShops),
      topShops,
      packageStats,
    };
  }

  private currentMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Day 0 of the next month is the last day of this one. */
  private lastDayOf(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y!, m!, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  }

  /** One broken tile shouldn't blank the whole report — same as the dashboard. */
  private async scalar(sql: string, params: unknown[] = []): Promise<string> {
    try {
      const rows = await this.dataSource.query<Array<{ c: string | number }>>(sql, params);
      return String(rows[0]?.c ?? 0);
    } catch (err) {
      this.logger.warn(`finance scalar failed: ${String(err)}`);
      return '0';
    }
  }

  private async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return await this.dataSource.query<T[]>(sql, params);
    } catch (err) {
      this.logger.warn(`finance rows failed: ${String(err)}`);
      return [];
    }
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
          targetType: 'platform_expenses',
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
