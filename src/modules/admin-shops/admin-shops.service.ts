import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';

export type ShopStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export interface PendingShopRow {
  id: number;
  shopCode: string;
  name: string;
  ownerName: string | null;
  phone: string | null;
  email: string;
  status: ShopStatus;
  createdAt: string;
  shopFrontUrl: string | null;
  shopInsideUrl: string | null;
  packageName: string | null;
}

export interface PendingShopPage {
  rows: PendingShopRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ShopListRow extends PendingShopRow {
  ownerIdCard: string | null;
  address: string | null;
  taxId: string | null;
  packageId: number;
  trialEndAt: string | null;
  packageEndAt: string | null;
  shopTypeIds: string | null;
}

export interface ShopListPage {
  rows: ShopListRow[];
  total: number;
  activeCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  types: Array<{ id: number; name: string }>;
}

export interface ShopDetail extends ShopListRow {
  packageName: string | null;
  trialStartAt: string | null;
  packageStartAt: string | null;
  orderMode: string | null;
  kitchenOutput: string | null;
  printerIp: string | null;
  billingType: string | null;
  buffetPricePerHead: string | null;
  stats: { tables: number; menus: number; orders: number };
  types: string[];
  activeStart: string | null;
  activeEnd: string | null;
  daysLeft: number | null;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

const PAGE_SIZE = 30;

@Injectable()
export class AdminShopsService {
  private readonly logger = new Logger(AdminShopsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async listPending(page = 1): Promise<PendingShopPage> {
    await this.suspendShopsMissingImages();

    const current = page > 0 ? page : 1;
    const offset = (current - 1) * PAGE_SIZE;

    const [countRows, rows] = await Promise.all([
      this.dataSource.query<Array<{ c: string }>>(
        "SELECT COUNT(*) AS c FROM shops WHERE status = 'pending' AND deleted_at IS NULL",
      ),
      this.dataSource.query<PendingShopRow[]>(
        `SELECT s.id                AS id,
                s.shop_code         AS shopCode,
                s.name              AS name,
                s.owner_name        AS ownerName,
                s.phone             AS phone,
                s.email             AS email,
                s.status            AS status,
                s.created_at        AS createdAt,
                s.shop_front_url    AS shopFrontUrl,
                s.shop_inside_url   AS shopInsideUrl,
                p.name              AS packageName
           FROM shops s
           LEFT JOIN packages p ON s.package_id = p.id
          WHERE s.deleted_at IS NULL AND s.status = 'pending'
          ORDER BY s.created_at DESC
          LIMIT ? OFFSET ?`,
        [PAGE_SIZE, offset],
      ),
    ]);

    const total = Number(countRows[0]?.c ?? 0);

    return {
      rows,
      total,
      page: current,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    };
  }

  async updateStatus(shopId: number, status: ShopStatus, actor: ActorMeta): Promise<void> {
    const rows = await this.dataSource.query<
      Array<{ shopFrontUrl: string | null; shopInsideUrl: string | null }>
    >(
      'SELECT shop_front_url AS shopFrontUrl, shop_inside_url AS shopInsideUrl FROM shops WHERE id = ? AND deleted_at IS NULL',
      [shopId],
    );

    const shop = rows[0];
    if (!shop) throw new NotFoundException('ไม่พบร้านค้านี้');

    // KYB rule from the legacy page: a shop cannot go live until both
    // verification photos exist.
    if (status === 'active' && (!shop.shopFrontUrl || !shop.shopInsideUrl)) {
      throw new BadRequestException(
        'ไม่สามารถเปิดใช้งานได้ เนื่องจากร้านค้ายังอัปโหลดรูปภาพหลักฐานไม่ครบถ้วน',
      );
    }

    await this.dataSource.query('UPDATE shops SET status = ? WHERE id = ?', [status, shopId]);

    await this.writeLog(actor, 'shop.update_status', shopId, JSON.stringify({ status }));
  }

  async softDelete(shopId: number, actor: ActorMeta): Promise<void> {
    const result = await this.dataSource.query<{ affectedRows?: number }>(
      "UPDATE shops SET deleted_at = NOW(), status = 'suspended' WHERE id = ? AND deleted_at IS NULL",
      [shopId],
    );

    if (result?.affectedRows === 0) throw new NotFoundException('ไม่พบร้านค้านี้');

    await this.writeLog(actor, 'shop.soft_delete', shopId, null);
  }

  /**
   * Backs the combined list page. `status` empty = every shop, which is what
   * shop_list.php showed; the rejected/suspended screens were the same query
   * with a fixed status.
   */
  async list(status: string | undefined, search: string | undefined, page = 1): Promise<ShopListPage> {
    await this.suspendShopsMissingImages();

    const clauses = ['s.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (status) {
      clauses.push('s.status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(s.name LIKE ? OR s.shop_code LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = clauses.join(' AND ');

    const current = page > 0 ? page : 1;
    const offset = (current - 1) * PAGE_SIZE;

    const [countRows, activeRows, rows, types] = await Promise.all([
      this.dataSource.query<Array<{ c: string }>>(
        `SELECT COUNT(*) AS c FROM shops s WHERE ${where}`,
        params,
      ),
      this.dataSource.query<Array<{ c: string }>>(
        "SELECT COUNT(*) AS c FROM shops WHERE status = 'active' AND deleted_at IS NULL",
      ),
      this.dataSource.query<ShopListRow[]>(
        `${this.selectSql()} WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
        [...params, PAGE_SIZE, offset],
      ),
      this.dataSource.query<Array<{ id: number; name: string }>>(
        'SELECT id, name FROM shop_types ORDER BY name',
      ),
    ]);

    const total = Number(countRows[0]?.c ?? 0);

    return {
      rows,
      total,
      activeCount: Number(activeRows[0]?.c ?? 0),
      page: current,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      types,
    };
  }

  async detail(shopId: number): Promise<ShopDetail> {
    // Same guard the legacy detail page ran before reading the row.
    await this.dataSource.query(
      `UPDATE shops SET status = 'suspended'
        WHERE id = ? AND status = 'active'
          AND (shop_front_url IS NULL OR shop_front_url = ''
            OR shop_inside_url IS NULL OR shop_inside_url = '')`,
      [shopId],
    );

    const rows = await this.dataSource.query<ShopDetail[]>(
      `${this.selectSql()}, s.trial_start_at AS trialStartAt, s.package_start_at AS packageStartAt,
              s.order_mode AS orderMode, s.kitchen_output AS kitchenOutput, s.printer_ip AS printerIp,
              s.billing_type AS billingType, s.buffet_price_per_head AS buffetPricePerHead
         WHERE s.id = ? AND s.deleted_at IS NULL`,
      [shopId],
    );

    const shop = rows[0];
    if (!shop) throw new NotFoundException('ไม่พบร้านค้านี้');

    const [tables, menus, orders, typeNames] = await Promise.all([
      this.countBy('SELECT COUNT(*) AS c FROM tables WHERE shop_id = ?', shopId),
      this.countBy('SELECT COUNT(*) AS c FROM shop_menus WHERE shop_id = ?', shopId),
      this.countBy('SELECT COUNT(*) AS c FROM orders WHERE shop_id = ?', shopId),
      this.resolveTypeNames(shop.shopTypeIds),
    ]);

    // Trial (package_id 1) tracks trial_*; paid packages fall back to it when
    // package_* was never filled in.
    const isTrial = Number(shop.packageId) === 1;
    const activeStart = isTrial
      ? shop.trialStartAt
      : (shop.packageStartAt ?? shop.trialStartAt);
    const activeEnd = isTrial ? shop.trialEndAt : (shop.packageEndAt ?? shop.trialEndAt);

    const daysLeft = activeEnd
      ? Math.ceil((new Date(activeEnd).getTime() - Date.now()) / 86_400_000)
      : null;

    return { ...shop, stats: { tables, menus, orders }, types: typeNames, activeStart, activeEnd, daysLeft };
  }

  private selectSql(): string {
    return `SELECT s.id              AS id,
                   s.shop_code       AS shopCode,
                   s.name            AS name,
                   s.owner_name      AS ownerName,
                   s.owner_id_card   AS ownerIdCard,
                   s.address         AS address,
                   s.tax_id          AS taxId,
                   s.phone           AS phone,
                   s.email           AS email,
                   s.status          AS status,
                   s.created_at      AS createdAt,
                   s.shop_front_url  AS shopFrontUrl,
                   s.shop_inside_url AS shopInsideUrl,
                   s.package_id      AS packageId,
                   s.trial_end_at    AS trialEndAt,
                   s.package_end_at  AS packageEndAt,
                   s.shop_type_ids   AS shopTypeIds,
                   p.name            AS packageName
              FROM shops s
              LEFT JOIN packages p ON s.package_id = p.id`;
  }

  private async countBy(sql: string, shopId: number): Promise<number> {
    try {
      const rows = await this.dataSource.query<Array<{ c: string }>>(sql, [shopId]);
      return Number(rows[0]?.c ?? 0);
    } catch (err) {
      this.logger.warn(`stat query failed: ${String(err)}`);
      return 0;
    }
  }

  /** shop_type_ids holds a JSON array of ids; bad/legacy values yield no badges. */
  private async resolveTypeNames(raw: string | null): Promise<string[]> {
    if (!raw) return [];
    let ids: unknown;
    try {
      ids = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const numeric = ids.map(Number).filter((n) => Number.isInteger(n));
    if (numeric.length === 0) return [];

    const rows = await this.dataSource.query<Array<{ name: string }>>(
      `SELECT name FROM shop_types WHERE id IN (${numeric.map(() => '?').join(',')})`,
      numeric,
    );
    return rows.map((r) => r.name);
  }

  /**
   * Same sweep the legacy page ran on every load: an active shop that is
   * missing either KYB photo gets suspended until it re-uploads.
   */
  private async suspendShopsMissingImages(): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE shops SET status = 'suspended'
          WHERE status = 'active'
            AND (shop_front_url IS NULL OR shop_front_url = ''
              OR shop_inside_url IS NULL OR shop_inside_url = '')`,
      );
    } catch (err) {
      this.logger.warn(`auto-suspend sweep failed: ${String(err)}`);
    }
  }

  /** audit_logs.new_value has a json_valid() CHECK — pass JSON or null, never bare text. */
  private async writeLog(
    actor: ActorMeta,
    action: string,
    targetId: number,
    newValue: string | null,
  ): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: actor.adminId,
          action,
          targetType: 'shops',
          targetId,
          newValue,
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        }),
      );
    } catch (err) {
      this.logger.warn(`audit_log write failed (${action}, shop ${targetId}): ${String(err)}`);
    }
  }
}
