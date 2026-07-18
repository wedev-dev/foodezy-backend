import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
        WHERE st.phone = ? AND s.deleted_at IS NULL
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
        WHERE st.id = ? AND s.deleted_at IS NULL
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
