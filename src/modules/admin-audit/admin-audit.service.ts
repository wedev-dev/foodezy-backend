import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

export interface AuditLogRow {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: number | null;
  adminName: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  newValue: string | null;
}

export interface AdminOption {
  adminId: number;
  adminName: string;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  admins: AdminOption[];
}

const PAGE_SIZE = 50;
/** Hard ceiling so a wide export can't pull the whole table into memory. */
const EXPORT_LIMIT = 5000;

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(query: AuditLogQueryDto): Promise<AuditLogPage> {
    const { where, params } = this.buildWhere(query);
    const page = query.page && query.page > 0 ? query.page : 1;
    const offset = (page - 1) * PAGE_SIZE;

    const [countRows, rows, admins] = await Promise.all([
      this.dataSource.query<Array<{ c: string }>>(
        `SELECT COUNT(*) AS c FROM audit_logs al WHERE ${where}`,
        params,
      ),
      this.dataSource.query<AuditLogRow[]>(
        `${this.selectSql()} WHERE ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
        [...params, PAGE_SIZE, offset],
      ),
      this.dataSource.query<AdminOption[]>(
        'SELECT admin_id AS adminId, admin_name AS adminName FROM admintb ORDER BY admin_name ASC',
      ),
    ]);

    const total = Number(countRows[0]?.c ?? 0);

    return {
      rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      admins,
    };
  }

  async export(query: AuditLogQueryDto): Promise<AuditLogRow[]> {
    const { where, params } = this.buildWhere(query);
    return this.dataSource.query<AuditLogRow[]>(
      `${this.selectSql()} WHERE ${where} ORDER BY al.created_at DESC LIMIT ?`,
      [...params, EXPORT_LIMIT],
    );
  }

  private selectSql(): string {
    return `
      SELECT al.id AS id,
             al.created_at AS createdAt,
             al.actor_type AS actorType,
             al.actor_id AS actorId,
             ad.admin_name AS adminName,
             al.action AS action,
             al.target_type AS targetType,
             al.target_id AS targetId,
             al.new_value AS newValue
        FROM audit_logs al
        LEFT JOIN admintb ad ON al.actor_id = ad.admin_id AND al.actor_type = 'admin'`;
  }

  /** All filters are bound as parameters — never interpolated into the SQL. */
  private buildWhere(query: AuditLogQueryDto): { where: string; params: unknown[] } {
    const clauses = ['1=1'];
    const params: unknown[] = [];

    if (query.adminId !== undefined) {
      clauses.push('al.actor_id = ?');
      params.push(query.adminId);
    }
    if (query.action) {
      clauses.push('al.action LIKE ?');
      params.push(`${query.action}%`);
    }
    if (query.dateStart) {
      clauses.push('DATE(al.created_at) >= ?');
      params.push(query.dateStart);
    }
    if (query.dateEnd) {
      clauses.push('DATE(al.created_at) <= ?');
      params.push(query.dateEnd);
    }

    return { where: clauses.join(' AND '), params };
  }
}
