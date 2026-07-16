import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compare, hash } from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { Admin } from '../admin-auth/entities/admin.entity';

const BCRYPT_ROUNDS = 10;

export interface ChangePasswordMeta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminAccountService {
  private readonly logger = new Logger(AdminAccountService.name);

  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async changePassword(
    adminId: number,
    oldPassword: string,
    newPassword: string,
    meta: ChangePasswordMeta,
  ): Promise<void> {
    const admin = await this.admins.findOne({ where: { adminId } });
    if (!admin) throw new BadRequestException('ไม่พบบัญชีผู้ใช้');

    const ok = await this.verify(oldPassword, admin.password);
    if (!ok) throw new BadRequestException('รหัสผ่านปัจจุบันไม่ถูกต้อง');

    if (oldPassword === newPassword) {
      throw new BadRequestException('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }

    // Always store a hash from now on. The legacy page wrote plain text, which
    // is why the main admin row is still readable in the database.
    const wasPlainText = !/^\$2[aby]\$/.test(admin.password);
    admin.password = await hash(newPassword, BCRYPT_ROUNDS);
    await this.admins.save(admin);

    await this.writeAuditLog(adminId, wasPlainText, meta);
  }

  private async verify(input: string, stored: string): Promise<boolean> {
    if (/^\$2[aby]\$/.test(stored)) return compare(input, stored);
    const a = Buffer.from(input, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async writeAuditLog(
    adminId: number,
    wasPlainText: boolean,
    meta: ChangePasswordMeta,
  ): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: adminId,
          action: 'admin.change_password',
          targetType: 'admintb',
          targetId: adminId,
          // The column has a json_valid() CHECK — never write bare text here.
          // The password itself is of course never logged.
          newValue: JSON.stringify({ hashed: true, migratedFromPlainText: wasPlainText }),
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
    } catch (err) {
      this.logger.warn(`audit_log write failed for admin ${adminId}: ${String(err)}`);
    }
  }
}
