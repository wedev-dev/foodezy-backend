import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveShopDto } from './dto/save-shop.dto';

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

export interface UploadedImages {
  shopFront?: Array<{ filename: string }>;
  shopInside?: Array<{ filename: string }>;
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
    private readonly config: ConfigService,
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

  async create(dto: SaveShopDto, files: UploadedImages, actor: ActorMeta): Promise<{ id: number; shopCode: string }> {
    const dup = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shops WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [dto.email],
    );
    if (dup.length > 0) throw new ConflictException('อีเมลนี้ถูกใช้งานในระบบแล้ว กรุณาใช้อีเมลอื่น');

    // shops.password is NOT NULL, and the shop-side login reads it, so a shop
    // created without one could never sign in.
    // Held in a local const: narrowing on dto.password would not survive into
    // the transaction callback below.
    const password = dto.password;
    if (!password) {
      throw new BadRequestException('กรุณากำหนดรหัสผ่านสำหรับร้านค้า');
    }

    const frontUrl = this.fileUrl(files.shopFront?.[0]);
    const insideUrl = this.fileUrl(files.shopInside?.[0]);
    const status = this.enforceKybStatus(dto.status, frontUrl, insideUrl);
    const { trialStart, trialEnd, pkgStart, pkgEnd } = this.freshWindow(dto.packageId);

    return this.dataSource.transaction(async (trx) => {
      const result = await trx.query<{ insertId: number }>(
        `INSERT INTO shops (
           shop_code, name, owner_name, owner_id_card, phone, email, password, address, tax_id,
           package_id, status, trial_start_at, trial_end_at, package_start_at, package_end_at,
           shop_front_url, shop_inside_url, shop_type_ids, is_open, created_at,
           order_mode, kitchen_output, printer_ip, billing_type, buffet_price_per_head
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?, ?, ?, ?)`,
        [
          'PENDING',
          dto.name,
          dto.ownerName,
          dto.ownerIdCard ?? null,
          dto.phone,
          dto.email,
          this.preparePassword(password),
          dto.address ?? null,
          dto.taxId ?? null,
          dto.packageId,
          status,
          trialStart,
          trialEnd,
          pkgStart,
          pkgEnd,
          frontUrl,
          insideUrl,
          this.normaliseTypeIds(dto.shopTypeIds),
          dto.orderMode ?? 'qr_only',
          dto.kitchenOutput ?? 'screen',
          dto.printerIp || null,
          dto.billingType ?? 'per_item',
          dto.buffetPricePerHead ?? null,
        ],
      );

      const id = Number(result.insertId);
      // Same scheme the public registration already writes, so both sources
      // produce codes in one format.
      const shopCode = this.buildShopCode(id);
      await trx.query('UPDATE shops SET shop_code = ? WHERE id = ?', [shopCode, id]);

      await this.writeLog(actor, 'shop.create_register', id, JSON.stringify({ shopCode, status }));
      return { id, shopCode };
    });
  }

  async update(shopId: number, dto: SaveShopDto, files: UploadedImages, actor: ActorMeta): Promise<void> {
    const rows = await this.dataSource.query<
      Array<{
        packageId: number;
        trialStartAt: string | null;
        trialEndAt: string | null;
        packageStartAt: string | null;
        packageEndAt: string | null;
        shopFrontUrl: string | null;
        shopInsideUrl: string | null;
      }>
    >(
      `SELECT package_id AS packageId, trial_start_at AS trialStartAt, trial_end_at AS trialEndAt,
              package_start_at AS packageStartAt, package_end_at AS packageEndAt,
              shop_front_url AS shopFrontUrl, shop_inside_url AS shopInsideUrl
         FROM shops WHERE id = ? AND deleted_at IS NULL`,
      [shopId],
    );
    const current = rows[0];
    if (!current) throw new NotFoundException('ไม่พบร้านค้านี้');

    const dupe = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM shops WHERE email = ? AND id <> ? AND deleted_at IS NULL LIMIT 1',
      [dto.email, shopId],
    );
    if (dupe.length > 0) throw new ConflictException('อีเมลนี้ถูกใช้งานโดยร้านอื่นแล้ว');

    let frontUrl = current.shopFrontUrl;
    let insideUrl = current.shopInsideUrl;

    if (dto.deleteFrontFlag === '1') {
      await this.removeFile(frontUrl);
      frontUrl = null;
    }
    if (dto.deleteInsideFlag === '1') {
      await this.removeFile(insideUrl);
      insideUrl = null;
    }
    // A newly uploaded file always wins over the delete flag.
    if (files.shopFront?.[0]) {
      await this.removeFile(current.shopFrontUrl);
      frontUrl = this.fileUrl(files.shopFront[0]);
    }
    if (files.shopInside?.[0]) {
      await this.removeFile(current.shopInsideUrl);
      insideUrl = this.fileUrl(files.shopInside[0]);
    }

    const status = this.enforceKybStatus(dto.status, frontUrl, insideUrl);
    const dates = this.rollPackageWindow(Number(current.packageId), dto.packageId, current);

    // Only touch the password column when a new one was actually typed.
    const passwordSql = dto.password ? 'password = ?,' : '';
    const passwordParam = dto.password ? [this.preparePassword(dto.password)] : [];

    await this.dataSource.query(
      `UPDATE shops SET
         name = ?, owner_name = ?, owner_id_card = ?, phone = ?, email = ?, ${passwordSql} address = ?, tax_id = ?,
         package_id = ?, status = ?,
         trial_start_at = ?, trial_end_at = ?, package_start_at = ?, package_end_at = ?,
         shop_front_url = ?, shop_inside_url = ?, shop_type_ids = ?,
         order_mode = ?, kitchen_output = ?, printer_ip = ?, billing_type = ?, buffet_price_per_head = ?
       WHERE id = ?`,
      [
        dto.name,
        dto.ownerName,
        dto.ownerIdCard ?? null,
        dto.phone,
        dto.email,
        ...passwordParam,
        dto.address ?? null,
        dto.taxId ?? null,
        dto.packageId,
        status,
        dates.trialStart,
        dates.trialEnd,
        dates.pkgStart,
        dates.pkgEnd,
        frontUrl,
        insideUrl,
        this.normaliseTypeIds(dto.shopTypeIds),
        dto.orderMode ?? 'qr_only',
        dto.kitchenOutput ?? 'screen',
        dto.printerIp || null,
        dto.billingType ?? 'per_item',
        dto.buffetPricePerHead ?? null,
        shopId,
      ],
    );

    await this.writeLog(
      actor,
      'shop.update_edit',
      shopId,
      // Never log the password value itself, only that it changed.
      JSON.stringify({ status, packageId: dto.packageId, passwordChanged: Boolean(dto.password) }),
    );
  }

  /** Dropdown data for the create/edit forms. */
  async formMeta(): Promise<{ packages: Array<{ id: number; name: string }>; types: Array<{ id: number; name: string }> }> {
    const [packages, types] = await Promise.all([
      this.dataSource.query<Array<{ id: number; name: string }>>(
        'SELECT id, name FROM packages ORDER BY id',
      ),
      this.dataSource.query<Array<{ id: number; name: string }>>(
        'SELECT id, name FROM shop_types WHERE is_active = 1 ORDER BY name',
      ),
    ]);
    return { packages, types };
  }

  /** The KYB rule again: no photos, no live shop — whatever the form asked for. */
  private enforceKybStatus(wanted: string, front: string | null, inside: string | null): string {
    return !front || !inside ? 'suspended' : wanted;
  }

  private freshWindow(packageId: number): {
    trialStart: string | null;
    trialEnd: string | null;
    pkgStart: string | null;
    pkgEnd: string | null;
  } {
    const start = this.mysqlDate(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    endDate.setHours(23, 59, 59, 0);
    const end = this.mysqlDate(endDate);

    return packageId === 1
      ? { trialStart: start, trialEnd: end, pkgStart: null, pkgEnd: null }
      : { trialStart: null, trialEnd: null, pkgStart: start, pkgEnd: end };
  }

  /**
   * Legacy rule from shop_edit.php: switching package keeps the remaining time
   * if the current window is still valid, and starts a fresh 30 days if it has
   * already expired. Staying on the same package never touches the dates.
   */
  private rollPackageWindow(
    oldPkg: number,
    newPkg: number,
    cur: {
      trialStartAt: string | null;
      trialEndAt: string | null;
      packageStartAt: string | null;
      packageEndAt: string | null;
    },
  ): { trialStart: string | null; trialEnd: string | null; pkgStart: string | null; pkgEnd: string | null } {
    let trialStart = cur.trialStartAt;
    let trialEnd = cur.trialEndAt;
    let pkgStart = cur.packageStartAt;
    let pkgEnd = cur.packageEndAt;

    if (newPkg === oldPkg) return { trialStart, trialEnd, pkgStart, pkgEnd };

    const activeEnd = (oldPkg === 1 ? trialEnd : pkgEnd) ?? trialEnd;
    const expired = !activeEnd || new Date(activeEnd).getTime() < Date.now();

    if (expired) {
      return this.freshWindow(newPkg);
    }

    const carryStart = oldPkg === 1 ? trialStart : pkgStart;
    const carryEnd = oldPkg === 1 ? trialEnd : pkgEnd;

    if (newPkg === 1) {
      trialStart = carryStart;
      trialEnd = carryEnd;
    } else {
      pkgStart = carryStart;
      pkgEnd = carryEnd;
    }
    return { trialStart, trialEnd, pkgStart, pkgEnd };
  }

  private mysqlDate(d: Date): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /**
   * Single place where a shop password is prepared before storage.
   * Plain text for now, matching the shop-side login and the public
   * registration flow. To harden: hash here and in both login paths together.
   */
  private preparePassword(plain: string): string {
    return plain;
  }

  private buildShopCode(id: number): string {
    const yy = String(new Date().getFullYear()).slice(-2);
    return `S${yy}${id.toString(36).toUpperCase().padStart(4, '0')}`;
  }

  private fileUrl(file: { filename: string } | undefined): string | null {
    if (!file) return null;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    return `${prefix}/${file.filename}`;
  }

  /** Best-effort: a missing file on disk must not fail the save. */
  private async removeFile(url: string | null): Promise<void> {
    if (!url) return;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    if (!url.startsWith(`${prefix}/`)) return;
    const dir = this.config.get<string>('UPLOAD_DIR', './uploads');
    try {
      await unlink(join(dir, url.slice(prefix.length + 1)));
    } catch (err) {
      this.logger.warn(`could not delete ${url}: ${String(err)}`);
    }
  }

  /** Always store a clean JSON int array, never raw form input. */
  private normaliseTypeIds(raw: string | undefined): string {
    if (!raw) return '[]';
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return '[]';
      return JSON.stringify(parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0));
    } catch {
      return '[]';
    }
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
