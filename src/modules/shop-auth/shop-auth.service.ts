import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compare } from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';

export type ShopRole = 'owner' | 'staff';

export interface ShopTokenPayload {
  sub: number; // staffId (0 for the shop owner)
  shopId: number;
  role: ShopRole;
}

export interface ShopIdentity {
  shopId: number;
  shopName: string;
  role: ShopRole;
  staffId: number | null;
  name: string;
  isSuperadmin: boolean;
  permissions: string[];
}

export interface ShopSubscription {
  status: string;
  packageName: string;
  isTrial: boolean;
  priceMonthly: number | null;
  maxTables: number | null;
  usedTables: number;
  startAt: string | null;
  endAt: string | null;
  daysRemaining: number | null;
  expired: boolean;
  expiringSoon: boolean;
}

export interface LoginResult {
  token: string;
  maxAgeMs: number | null;
  identity: ShopIdentity;
}

const REMEMBER_DAYS = 90;
const SESSION_HOURS = 12;

interface ShopRow {
  id: number;
  name: string;
  password: string;
  status: string;
}
interface StaffRow {
  id: number;
  shopId: number;
  shopName: string;
  name: string;
  password: string;
  roleId: number | null;
  isSuperadmin: number;
  shopStatus: string;
}

@Injectable()
export class ShopAuthService {
  private readonly logger = new Logger(ShopAuthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Unified login by phone + password — no shop code needed.
   * Owner phone lives in `shops.phone`; staff phone in `shop_staff.phone`.
   * Owner is checked first, then staff.
   */
  async login(phone: string, password: string, remember: boolean): Promise<LoginResult> {
    const invalid = new UnauthorizedException('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง');
    const closed = new UnauthorizedException('ร้านค้านี้ยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');

    // 1) Shop owner (shops.phone)
    const shopRows = await this.dataSource.query<ShopRow[]>(
      `SELECT id, name, password, status
         FROM shops
        WHERE phone = ? AND deleted_at IS NULL
        LIMIT 1`,
      [phone],
    );
    const shop = shopRows[0];
    if (shop) {
      if (!(await this.verifyPassword(password, shop.password))) throw invalid;
      if (shop.status !== 'active') throw closed;
      await this.upgradePasswordIfNeeded('shops', shop.id, password, shop.password);

      return this.buildResult({ sub: 0, shopId: shop.id, role: 'owner' }, remember, {
        shopId: shop.id,
        shopName: shop.name,
        role: 'owner',
        staffId: null,
        name: shop.name,
        isSuperadmin: true,
        permissions: await this.allPermissionSlugs(),
      });
    }

    // 2) Staff (shop_staff.phone)
    const staffRows = await this.dataSource.query<StaffRow[]>(
      `SELECT st.id, st.shop_id AS shopId, s.name AS shopName, st.name, st.password,
              st.role_id AS roleId, st.is_superadmin AS isSuperadmin, s.status AS shopStatus
         FROM shop_staff st
         JOIN shops s ON s.id = st.shop_id
        WHERE st.phone = ? AND s.deleted_at IS NULL AND st.is_active = 1
        LIMIT 1`,
      [phone],
    );
    const staff = staffRows[0];
    if (!staff) throw invalid;
    if (!(await this.verifyPassword(password, staff.password))) throw invalid;
    if (staff.shopStatus !== 'active') {
      throw new UnauthorizedException('ร้านค้านี้ยังไม่เปิดใช้งาน กรุณาติดต่อเจ้าของร้าน');
    }
    await this.upgradePasswordIfNeeded('shop_staff', staff.id, password, staff.password);

    const isSuperadmin = Number(staff.isSuperadmin) === 1;
    return this.buildResult({ sub: staff.id, shopId: staff.shopId, role: 'staff' }, remember, {
      shopId: staff.shopId,
      shopName: staff.shopName,
      role: 'staff',
      staffId: staff.id,
      name: staff.name,
      isSuperadmin,
      permissions: isSuperadmin
        ? await this.allPermissionSlugs()
        : await this.rolePermissionSlugs(staff.roleId),
    });
  }

  /** Re-reads identity + permissions each request so bans/role changes apply at once. */
  async resolveIdentity(payload: ShopTokenPayload): Promise<ShopIdentity | null> {
    if (payload.role === 'owner') {
      const rows = await this.dataSource.query<ShopRow[]>(
        `SELECT id, name, password, status FROM shops WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [payload.shopId],
      );
      const shop = rows[0];
      if (!shop || shop.status !== 'active') return null;
      return {
        shopId: shop.id,
        shopName: shop.name,
        role: 'owner',
        staffId: null,
        name: shop.name,
        isSuperadmin: true,
        permissions: await this.allPermissionSlugs(),
      };
    }

    const rows = await this.dataSource.query<StaffRow[]>(
      `SELECT st.id, st.shop_id AS shopId, s.name AS shopName, st.name, st.password,
              st.role_id AS roleId, st.is_superadmin AS isSuperadmin, s.status AS shopStatus
         FROM shop_staff st
         JOIN shops s ON s.id = st.shop_id
        WHERE st.id = ? AND s.deleted_at IS NULL AND st.is_active = 1
        LIMIT 1`,
      [payload.sub],
    );
    const staff = rows[0];
    if (!staff || staff.shopStatus !== 'active') return null;

    const isSuperadmin = Number(staff.isSuperadmin) === 1;
    return {
      shopId: staff.shopId,
      shopName: staff.shopName,
      role: 'staff',
      staffId: staff.id,
      name: staff.name,
      isSuperadmin,
      permissions: isSuperadmin
        ? await this.allPermissionSlugs()
        : await this.rolePermissionSlugs(staff.roleId),
    };
  }

  private async buildResult(
    payload: ShopTokenPayload,
    remember: boolean,
    identity: ShopIdentity,
  ): Promise<LoginResult> {
    const expiresIn = remember ? `${REMEMBER_DAYS}d` : `${SESSION_HOURS}h`;
    const token = await this.jwt.signAsync(payload, { expiresIn });
    return {
      token,
      maxAgeMs: remember ? REMEMBER_DAYS * 24 * 60 * 60 * 1000 : null,
      identity,
    };
  }

  // อัปเดตเวลาออนไลน์ล่าสุดของพนักงาน (ปลอดภัยแม้ยังไม่ได้ ALTER คอลัมน์)
  async touchLastSeen(shopId: number, staffId: number | null): Promise<void> {
    if (!staffId || staffId <= 0) return;
    try {
      await this.dataSource.query(
        `UPDATE shop_staff SET last_seen_at = NOW() WHERE id = ? AND shop_id = ?`,
        [staffId, shopId],
      );
    } catch {
      // คอลัมน์ last_seen_at ยังไม่มี -> ข้ามไปเงียบ ๆ
    }
  }

  // ข้อมูลแพ็กเกจ/การใช้งานของร้าน สำหรับแสดงในหน้าจัดการ + แจ้งเตือนต่ออายุ
  async subscription(shopId: number): Promise<ShopSubscription> {
    const rows = await this.dataSource.query<Array<{
      status: string;
      packageId: number | null;
      packageName: string | null;
      maxTables: number | null;
      priceMonthly: string | null;
      trialDays: number | null;
      trialStartAt: string | null;
      trialEndAt: string | null;
      packageStartAt: string | null;
      packageEndAt: string | null;
      usedTables: number;
    }>>(
      `SELECT s.status,
              s.package_id            AS packageId,
              p.name                  AS packageName,
              p.max_tables            AS maxTables,
              p.price_monthly         AS priceMonthly,
              p.trial_days            AS trialDays,
              s.trial_start_at        AS trialStartAt,
              s.trial_end_at          AS trialEndAt,
              s.package_start_at      AS packageStartAt,
              s.package_end_at        AS packageEndAt,
              (SELECT COUNT(*) FROM tables t WHERE t.shop_id = s.id) AS usedTables
         FROM shops s
         LEFT JOIN packages p ON p.id = s.package_id
        WHERE s.id = ?`,
      [shopId],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('ไม่พบข้อมูลร้าน');

    // mysql driver อาจคืน DATETIME เป็น Date object หรือ string -> รองรับทั้งสองแบบ
    const toDate = (v: string | Date | null): Date | null => {
      if (!v) return null;
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
      const d = new Date(String(v).replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const toStr = (v: string | Date | null): string | null => {
      const d = toDate(v);
      return d ? d.toISOString() : null;
    };

    // ร้านที่ยังเป็น Trial (package_id = 1) ให้ใช้ trial_end_at เป็นวันหมดอายุ ไม่งั้นใช้ package_end_at
    const isTrial = Number(r.packageId) === 1 || (!r.packageStartAt && !!r.trialEndAt);
    const endDate = toDate(isTrial ? r.trialEndAt : r.packageEndAt);
    const startAt = toStr(isTrial ? r.trialStartAt : r.packageStartAt);

    let daysRemaining: number | null = null;
    if (endDate) {
      daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / 86_400_000);
    }

    return {
      status: r.status,
      packageName: r.packageName ?? 'ยังไม่มีแพ็กเกจ',
      isTrial,
      priceMonthly: r.priceMonthly != null ? Number(r.priceMonthly) : null,
      maxTables: r.maxTables != null ? Number(r.maxTables) : null,
      usedTables: Number(r.usedTables ?? 0),
      startAt,
      endAt: endDate ? endDate.toISOString() : null,
      daysRemaining,
      expired: daysRemaining != null && daysRemaining < 0,
      expiringSoon: daysRemaining != null && daysRemaining >= 0 && daysRemaining <= 3,
    };
  }

  private async allPermissionSlugs(): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ slug: string }>>(
      'SELECT slug FROM system_permissions ORDER BY id ASC',
    );
    return rows.map((r) => r.slug);
  }

  private async rolePermissionSlugs(roleId: number | null): Promise<string[]> {
    if (!roleId) return [];
    const rows = await this.dataSource.query<Array<{ slug: string }>>(
      `SELECT sp.slug
         FROM role_has_permissions rhp
         JOIN system_permissions sp ON sp.id = rhp.permission_id
        WHERE rhp.role_id = ?
        ORDER BY sp.id ASC`,
      [roleId],
    );
    return rows.map((r) => r.slug);
  }

  /** Passwords may be bcrypt ($2a/$2b/$2y) or legacy plain text — support both. */
  private async verifyPassword(input: string, stored: string): Promise<boolean> {
    if (/^\$2[aby]\$/.test(stored)) return compare(input, stored);
    const a = Buffer.from(input, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // NOTE: auto-upgrade to bcrypt is DISABLED during development so plain-text
  // passwords set in phpMyAdmin stay plain text. Restore the body to re-enable.
  private async upgradePasswordIfNeeded(
    _table: 'shops' | 'shop_staff',
    _id: number,
    _plain: string,
    _stored: string,
  ): Promise<void> {
    return;
  }
}
