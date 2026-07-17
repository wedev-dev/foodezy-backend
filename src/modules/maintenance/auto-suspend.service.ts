import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class AutoSuspendService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AutoSuspendService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  /**
   * The legacy cron_auto_suspend.php needed an OS cron entry, and before that
   * the rule only ran when an admin happened to log in. Running it on a timer
   * inside the app keeps it working with no server-side setup.
   */
  onApplicationBootstrap(): void {
    void this.run('startup');
    this.timer = setInterval(() => void this.run('scheduled'), ONE_HOUR_MS);
    // Don't hold the process open just for this timer.
    this.timer.unref?.();
    this.logger.log('auto-suspend sweep scheduled (hourly)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(trigger: 'startup' | 'scheduled' | 'manual'): Promise<number> {
    // A slow sweep must not overlap with the next tick.
    if (this.running) {
      this.logger.warn('auto-suspend already running, skipping this tick');
      return 0;
    }
    this.running = true;

    try {
      const result = await this.dataSource.query<{ affectedRows?: number }>(
        `UPDATE shops
            SET status = 'suspended'
          WHERE status = 'active'
            AND (
                 (package_id = 1 AND trial_end_at < NOW())
              OR (package_id > 1 AND package_end_at < NOW())
            )`,
      );
      const affected = Number(result?.affectedRows ?? 0);

      if (affected > 0) {
        this.logger.log(`auto-suspend (${trigger}): suspended ${affected} shop(s)`);
        await this.writeLog(affected, trigger);
      }
      return affected;
    } catch (err) {
      // A failed sweep must never take the app down — it retries next hour.
      this.logger.error(`auto-suspend failed: ${String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async writeLog(affected: number, trigger: string): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          // actor_type 'system' separates this from anything an admin did.
          actorType: 'system',
          actorId: null,
          action: 'shop.auto_suspend',
          targetType: 'shops',
          targetId: null,
          newValue: JSON.stringify({ suspended: affected, trigger }),
          ipAddress: null,
          userAgent: null,
        }),
      );
    } catch (err) {
      this.logger.warn(`audit_log write failed (shop.auto_suspend): ${String(err)}`);
    }
  }
}
