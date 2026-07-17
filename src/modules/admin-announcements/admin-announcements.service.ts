import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

export interface AnnouncementRow {
  id: number;
  title: string;
  message: string;
  targetGroup: string;
  status: string;
  createdBy: number;
  creatorName: string | null;
  createdAt: string;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

/** Inserted per statement when fanning out, to stay well under max_allowed_packet. */
const FANOUT_CHUNK = 500;

@Injectable()
export class AdminAnnouncementsService {
  private readonly logger = new Logger(AdminAnnouncementsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async list(): Promise<AnnouncementRow[]> {
    return this.dataSource.query<AnnouncementRow[]>(
      `SELECT a.id           AS id,
              a.title        AS title,
              a.message      AS message,
              a.target_group AS targetGroup,
              a.status       AS status,
              a.created_by   AS createdBy,
              ad.admin_name  AS creatorName,
              a.created_at   AS createdAt
         FROM announcements a
         LEFT JOIN admintb ad ON a.created_by = ad.admin_id
        ORDER BY a.created_at DESC`,
    );
  }

  async create(
    dto: CreateAnnouncementDto,
    actor: ActorMeta,
  ): Promise<{ id: number; shopsNotified: number }> {
    const status = dto.publish ? 'active' : 'inactive';

    return this.dataSource.transaction(async (trx) => {
      const inserted = await trx.query<{ insertId: number }>(
        `INSERT INTO announcements (title, message, target_group, status, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [dto.title, dto.message, dto.targetGroup, status, actor.adminId],
      );
      const id = Number(inserted.insertId);

      // A draft is stored but never delivered — same as the legacy page.
      let shopsNotified = 0;
      if (status === 'active') {
        const shopIds = await this.targetShopIds(trx, dto.targetGroup);
        shopsNotified = shopIds.length;

        // The old code ran one INSERT per shop inside a loop; batching keeps a
        // broadcast to hundreds of shops from becoming hundreds of round trips.
        for (let i = 0; i < shopIds.length; i += FANOUT_CHUNK) {
          const chunk = shopIds.slice(i, i + FANOUT_CHUNK);
          const values = chunk.map(() => "(?, 'admin', ?, ?, 0)").join(', ');
          const params = chunk.flatMap((sid) => [sid, dto.title, dto.message]);
          await trx.query(
            `INSERT INTO shop_messages (shop_id, sender, subject, message, is_read) VALUES ${values}`,
            params,
          );
        }
      }

      await this.writeLog(
        actor,
        'system.announce_create',
        id,
        JSON.stringify({ title: dto.title, target: dto.targetGroup, shops_notified: shopsNotified }),
      );

      return { id, shopsNotified };
    });
  }

  async remove(id: number, actor: ActorMeta): Promise<void> {
    const result = await this.dataSource.query<{ affectedRows?: number }>(
      'DELETE FROM announcements WHERE id = ?',
      [id],
    );
    if (result?.affectedRows === 0) throw new NotFoundException('ไม่พบประกาศนี้');

    await this.writeLog(actor, 'system.announce_delete', id, null);
  }

  /** Messages already delivered to shops are left alone, as in the legacy page. */
  private async targetShopIds(
    trx: { query: <T>(sql: string, params?: unknown[]) => Promise<T> },
    targetGroup: string,
  ): Promise<number[]> {
    let sql: string;
    if (targetGroup === 'trial') {
      sql = `SELECT s.id AS id FROM shops s JOIN packages p ON s.package_id = p.id
              WHERE p.name = 'Trial' AND s.status = 'active' AND s.deleted_at IS NULL`;
    } else if (targetGroup === 'pro') {
      sql = `SELECT s.id AS id FROM shops s JOIN packages p ON s.package_id = p.id
              WHERE p.name IN ('Pro','Premium') AND s.status = 'active' AND s.deleted_at IS NULL`;
    } else {
      sql = "SELECT id FROM shops WHERE status = 'active' AND deleted_at IS NULL";
    }
    const rows = await trx.query<Array<{ id: number }>>(sql);
    return rows.map((r) => Number(r.id));
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
          targetType: 'announcements',
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
