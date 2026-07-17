import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { hash } from 'bcryptjs';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveAdminUserDto } from './dto/save-admin-user.dto';

const BCRYPT_ROUNDS = 10;
export const STATUS_ACTIVE = '99999';
export const STATUS_DISABLED = '00000';

export interface AdminUserRow {
  adminId: number;
  adminName: string;
  username: string;
  menuAccess: string;
  status: string;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  /** Password column is never selected — it must not reach the client. */
  async list(): Promise<AdminUserRow[]> {
    return this.dataSource.query<AdminUserRow[]>(
      `SELECT admin_id AS adminId, admin_name AS adminName, username,
              menu_access AS menuAccess, status
         FROM admintb ORDER BY admin_id ASC`,
    );
  }

  async create(dto: SaveAdminUserDto, actor: ActorMeta): Promise<number> {
    const password = dto.password;
    if (!password) throw new BadRequestException('กรุณากำหนดรหัสผ่าน');

    await this.assertUsernameFree(dto.username, null);

    const result = await this.dataSource.query<{ insertId: number }>(
      `INSERT INTO admintb (admin_name, username, password, menu_access, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        dto.adminName,
        dto.username,
        // Stored hashed. The login path accepts both bcrypt and the legacy
        // plain-text rows, so old accounts keep working.
        await hash(password, BCRYPT_ROUNDS),
        this.buildMenuAccess(dto),
        dto.status,
      ],
    );

    const id = Number(result.insertId);
    await this.writeLog(actor, 'admin.create', id, JSON.stringify({ username: dto.username }));
    return id;
  }

  async update(adminId: number, dto: SaveAdminUserDto, actor: ActorMeta): Promise<void> {
    const rows = await this.dataSource.query<Array<{ menuAccess: string }>>(
      'SELECT menu_access AS menuAccess FROM admintb WHERE admin_id = ?',
      [adminId],
    );
    if (rows.length === 0) throw new NotFoundException('ไม่พบบัญชีผู้ดูแลระบบนี้');

    await this.assertUsernameFree(dto.username, adminId);

    const menuAccess = this.buildMenuAccess(dto);

    // Guard rails the legacy page lacked: a superadmin could demote or disable
    // themselves and lock everyone out, with no way back except the database.
    if (adminId === actor.adminId) {
      if (rows[0]!.menuAccess === 'all' && menuAccess !== 'all') {
        throw new BadRequestException('ไม่สามารถลดสิทธิ์ Superadmin ของตัวเองได้');
      }
      if (dto.status !== STATUS_ACTIVE) {
        throw new BadRequestException('ไม่สามารถปิดใช้งานบัญชีของตัวเองได้');
      }
    }

    const password = dto.password;
    const passwordSql = password ? 'password = ?,' : '';
    const passwordParam = password ? [await hash(password, BCRYPT_ROUNDS)] : [];

    await this.dataSource.query(
      `UPDATE admintb SET admin_name = ?, username = ?, ${passwordSql} menu_access = ?, status = ?
        WHERE admin_id = ?`,
      [dto.adminName, dto.username, ...passwordParam, menuAccess, dto.status, adminId],
    );

    await this.writeLog(
      actor,
      'admin.update',
      adminId,
      JSON.stringify({ username: dto.username, passwordChanged: Boolean(password) }),
    );
  }

  async remove(adminId: number, actor: ActorMeta): Promise<void> {
    if (adminId === actor.adminId) {
      throw new BadRequestException('คุณไม่สามารถลบบัญชีของตัวเองได้');
    }

    const rows = await this.dataSource.query<Array<{ menuAccess: string }>>(
      'SELECT menu_access AS menuAccess FROM admintb WHERE admin_id = ?',
      [adminId],
    );
    if (rows.length === 0) throw new NotFoundException('ไม่พบบัญชีผู้ดูแลระบบนี้');

    if (rows[0]!.menuAccess === 'all') {
      const supers = await this.dataSource.query<Array<{ c: string }>>(
        "SELECT COUNT(*) AS c FROM admintb WHERE menu_access = 'all'",
      );
      if (Number(supers[0]?.c ?? 0) <= 1) {
        throw new BadRequestException('ไม่สามารถลบ Superadmin คนสุดท้ายได้');
      }
    }

    await this.dataSource.query('DELETE FROM admintb WHERE admin_id = ?', [adminId]);
    await this.writeLog(actor, 'admin.delete', adminId, null);
  }

  private async assertUsernameFree(username: string, excludeId: number | null): Promise<void> {
    const rows = await this.dataSource.query<Array<{ adminId: number }>>(
      excludeId === null
        ? 'SELECT admin_id AS adminId FROM admintb WHERE username = ? LIMIT 1'
        : 'SELECT admin_id AS adminId FROM admintb WHERE username = ? AND admin_id <> ? LIMIT 1',
      excludeId === null ? [username] : [username, excludeId],
    );
    if (rows.length > 0) {
      throw new ConflictException(
        excludeId === null
          ? 'Username นี้มีผู้ใช้งานแล้ว'
          : 'Username นี้ถูกใช้โดยพนักงานคนอื่นแล้ว',
      );
    }
  }

  /**
   * 'all' means superadmin; otherwise menu_access holds a JSON object of the
   * ticked modules — the exact shape mainmenu.php reads.
   */
  private buildMenuAccess(dto: SaveAdminUserDto): string {
    if (dto.accessType === 'all') return 'all';
    const perms: Record<string, boolean> = {};
    for (const key of dto.perms ?? []) perms[key] = true;
    return JSON.stringify(perms);
  }

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
          targetType: 'admintb',
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
