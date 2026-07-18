import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { UpdatePackageDto } from './dto/update-package.dto';

export interface PackageFeatures {
  inventory: boolean;
  analytics: boolean;
}

export interface PackageRow {
  id: number;
  name: string;
  priceMonthly: number;
  maxTables: number;
  maxMenuItems: number;
  dailyOrderLimit: number;
  trialDays: number;
  features: PackageFeatures;
  isActive: boolean;
  updatedAt: string | null;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

interface RawPackage {
  id: number;
  name: string;
  priceMonthly: string;
  maxTables: number;
  maxMenuItems: number;
  dailyOrderLimit: number;
  trialDays: number;
  features: string | null;
  isActive: number;
  updatedAt: string | null;
}

@Injectable()
export class AdminPackagesService {
  private readonly logger = new Logger(AdminPackagesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async list(): Promise<PackageRow[]> {
    const rows = await this.dataSource.query<RawPackage[]>(
      `SELECT id, name,
              price_monthly     AS priceMonthly,
              max_tables        AS maxTables,
              max_menu_items    AS maxMenuItems,
              daily_order_limit AS dailyOrderLimit,
              trial_days        AS trialDays,
              features          AS features,
              is_active         AS isActive,
              updated_at        AS updatedAt
         FROM packages
        ORDER BY id ASC`,
    );
    return rows.map((r) => this.toRow(r));
  }

  async update(id: number, dto: UpdatePackageDto, actor: ActorMeta): Promise<void> {
    const rows = await this.dataSource.query<RawPackage[]>(
      `SELECT id, name, price_monthly AS priceMonthly, max_tables AS maxTables,
              max_menu_items AS maxMenuItems, daily_order_limit AS dailyOrderLimit,
              trial_days AS trialDays, features AS features, is_active AS isActive,
              updated_at AS updatedAt
         FROM packages WHERE id = ?`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundException('ไม่พบแพ็กเกจนี้');

    const features: PackageFeatures = {
      inventory: dto.features.inventory,
      analytics: dto.features.analytics,
    };

    await this.dataSource.query(
      `UPDATE packages
          SET price_monthly = ?, max_tables = ?, max_menu_items = ?,
              daily_order_limit = ?, trial_days = ?, features = ?, is_active = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        dto.priceMonthly,
        dto.maxTables,
        dto.maxMenuItems,
        dto.dailyOrderLimit,
        dto.trialDays,
        JSON.stringify(features),
        dto.isActive ? 1 : 0,
        id,
      ],
    );

    await this.writeLog(
      actor,
      'billing.package_update',
      id,
      JSON.stringify(this.toRow(before)),
      JSON.stringify({
        id,
        name: before.name,
        priceMonthly: dto.priceMonthly,
        maxTables: dto.maxTables,
        maxMenuItems: dto.maxMenuItems,
        dailyOrderLimit: dto.dailyOrderLimit,
        trialDays: dto.trialDays,
        features,
        isActive: dto.isActive,
      }),
    );
  }

  private toRow(r: RawPackage): PackageRow {
    return {
      id: Number(r.id),
      name: r.name,
      priceMonthly: Number(r.priceMonthly),
      maxTables: Number(r.maxTables),
      maxMenuItems: Number(r.maxMenuItems),
      dailyOrderLimit: Number(r.dailyOrderLimit),
      trialDays: Number(r.trialDays),
      features: this.parseFeatures(r.features),
      isActive: Number(r.isActive) === 1,
      updatedAt: r.updatedAt,
    };
  }

  /** Legacy rows may hold partial or malformed JSON; default missing flags to false. */
  private parseFeatures(raw: string | null): PackageFeatures {
    if (!raw) return { inventory: false, analytics: false };
    try {
      const parsed: unknown = JSON.parse(raw);
      const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
      return { inventory: Boolean(obj.inventory), analytics: Boolean(obj.analytics) };
    } catch {
      return { inventory: false, analytics: false };
    }
  }

  private async writeLog(
    actor: ActorMeta,
    action: string,
    targetId: number,
    oldValue: string | null,
    newValue: string | null,
  ): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: actor.adminId,
          action,
          targetType: 'packages',
          targetId,
          oldValue,
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
