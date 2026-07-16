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
