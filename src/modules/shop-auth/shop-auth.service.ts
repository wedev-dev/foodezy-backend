import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compare, hash } from 'bcryptjs';
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

export interface LoginMeta {
  ip: string | null;
  userAgent: string | null;
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

  /** Shop owner logs in with phone + password (checked against `shops`). */
  async loginOwner(phone: string, password: string, remember: boolean): Promise<LoginResult> {
    const invalid = new UnauthorizedException('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง');

    const rows = await this.dataSource.query<ShopRow[]>(
      `SELECT id, name, password, status
         FROM shops
        WHERE phone = ? AND deleted_at IS NULL
        LIMIT 1`,
      [phone],
    );
    const shop = rows[0];
    if (!shop) throw invalid;

    const ok = await this.verifyPassword(password, shop.password);
    if (!ok) throw invalid;

    if (shop.status !== 'active') {
      throw new UnauthorizedException('ร้านค้านี้ยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    }

    // Migrate legacy plain-text passwords to bcrypt on first successful login.
    await this.upgradePasswordIfNeeded('shops', shop.id, password, shop.password);

    const permissions = await this.allPermissionSlugs();
    const payload: ShopTokenPayload = { sub: 0, shopId: shop.id, role: 'owner' };
    return this.buildResult(payload, remember, {
      shopId: shop.id,
      shopName: shop.name,
      role: 'owner',
      staffId: null,
      name: shop.name,
      isSuperadmin: true,
      permissions,
    });
  }

  /** Staff logs in with shop code + username + password (checked against `shop_staff`). */
  async loginStaff(
    shopCode: string,
    username: string,
    password: string,
    remember: boolean,
  ): Promise<LoginResult> {
    const invalid = new UnauthorizedException('ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');

    const rows = await this.dataSource.query<StaffRow[]>(
      `SELECT st.id, st.shop_id AS shopId, s.name AS shopName, st.name, st.password,
              st.role_id AS roleId, st.is_superadmin AS isSuperadmin, s.status AS shopStatus
         FROM shop_staff st
         JOIN shops s ON s.id = st.shop_id
        WHERE s.shop_code = ? AND st.username = ? AND s.deleted_at IS NULL
        LIMIT 1`,
      [shopCode, username],
    );
    const staff = rows[0];
    if (!staff) throw invalid;

    const ok = await this.verifyPassword(password, staff.password);
    if (!ok) throw invalid;

    if (staff.shopStatus !== 'active') {
      throw new UnauthorizedException('ร้านค้านี้ยังไม่เปิดใช้งาน กรุณาติดต่อเจ้าของร้าน');
    }

    await this.upgradePasswordIfNeeded('shop_staff', staff.id, password, staff.password);

    const isSuperadmin = Number(staff.isSuperadmin) === 1;
    const permissions = isSuperadmin
      ? await this.allPermissionSlugs()
      : await this.rolePermissionSlugs(staff.roleId);

    const payload: ShopTokenPayload = { sub: staff.id, shopId: staff.shopId, role: 'staff' };
    return this.buildResult(payload, remember, {
      shopId: staff.shopId,
      shopName: staff.shopName,
      role: 'staff',
      staffId: staff.id,
      name: staff.name,
      isSuperadmin,
      permissions,
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

  /**
   * Passwords may be bcrypt ($2a/$2b/$2y) or legacy plain text. Support both,
   * then rewrite plain-text rows to bcrypt on the next successful login.
   */
  private async verifyPassword(input: string, stored: string): Promise<boolean> {
    if (/^\$2[aby]\$/.test(stored)) return compare(input, stored);
    const a = Buffer.from(input, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async upgradePasswordIfNeeded(
    table: 'shops' | 'shop_staff',
    id: number,
    plain: string,
    stored: string,
  ): Promise<void> {
    if (/^\$2[aby]\$/.test(stored)) return; // already hashed
    try {
      const newHash = await hash(plain, 10);
      await this.dataSource.query(`UPDATE ${table} SET password = ? WHERE id = ?`, [newHash, id]);
    } catch (err) {
      this.logger.warn(`password upgrade failed for ${table}#${id}: ${String(err)}`);
    }
  }
}
