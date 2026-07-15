import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compare } from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { Admin, ADMIN_STATUS_DISABLED } from './entities/admin.entity';

export interface AdminPayload {
  sub: number;
  name: string;
  access: string;
}

export interface AdminProfile {
  adminId: number;
  adminName: string;
  menuAccess: string;
}

export interface LoginMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  maxAgeMs: number | null;
  admin: AdminProfile;
}

/** Same window the legacy PHP used for its "remember me" cookie. */
const REMEMBER_DAYS = 90;
const SESSION_HOURS = 8;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    private readonly jwt: JwtService,
  ) {}

  async login(
    username: string,
    password: string,
    remember: boolean,
    meta: LoginMeta,
  ): Promise<LoginResult> {
    const admin = await this.admins.findOne({ where: { username } });

    // Same message for "no such user" and "wrong password" — telling them apart
    // lets an attacker enumerate valid usernames.
    const invalid = new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!admin) throw invalid;

    const ok = await this.verifyPassword(password, admin.password);
    if (!ok) throw invalid;

    if (admin.status === ADMIN_STATUS_DISABLED) {
      throw new UnauthorizedException('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    }

    const menuAccess = admin.menuAccess ?? 'none';
    const payload: AdminPayload = {
      sub: admin.adminId,
      name: admin.adminName,
      access: menuAccess,
    };

    const expiresIn = remember ? `${REMEMBER_DAYS}d` : `${SESSION_HOURS}h`;
    const token = await this.jwt.signAsync(payload, { expiresIn });

    await this.writeAuditLog(admin.adminId, meta);

    return {
      token,
      // null => session cookie (cleared when the browser closes)
      maxAgeMs: remember ? REMEMBER_DAYS * 24 * 60 * 60 * 1000 : null,
      admin: { adminId: admin.adminId, adminName: admin.adminName, menuAccess },
    };
  }

  /** Re-reads the admin so a disabled/deleted account loses access immediately. */
  async findActiveById(adminId: number): Promise<AdminProfile | null> {
    const admin = await this.admins.findOne({ where: { adminId } });
    if (!admin || admin.status === ADMIN_STATUS_DISABLED) return null;

    return {
      adminId: admin.adminId,
      adminName: admin.adminName,
      menuAccess: admin.menuAccess ?? 'none',
    };
  }

  /**
   * `admintb` holds two password formats side by side:
   *   - bcrypt hashes written by the old hash_admin_passwords.php run ($2y$/$2a$/$2b$)
   *   - plain text rows the migration never reached (e.g. the main admin)
   * The legacy login.php only compared plain text, which silently locked out
   * every hashed account. Support both, then drop the plain branch once every
   * row is hashed.
   */
  private async verifyPassword(input: string, stored: string): Promise<boolean> {
    if (/^\$2[aby]\$/.test(stored)) {
      return compare(input, stored);
    }

    const a = Buffer.from(input, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Audit failure must never block a valid login. */
  private async writeAuditLog(adminId: number, meta: LoginMeta): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: adminId,
          action: 'admin.login',
          targetType: 'admintb',
          targetId: adminId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
    } catch (err) {
      this.logger.warn(`audit_log write failed for admin ${adminId}: ${String(err)}`);
    }
  }
}
