import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { SaveWebhookDto } from './dto/save-webhook.dto';
import { TestWebhookDto } from './dto/test-webhook.dto';

export interface WebhookConfig {
  endpointUrl: string;
  authToken: string;
  isActive: boolean;
  updatedAt: string | null;
}

export interface WebhookTestResult {
  status: 'success' | 'error';
  code: number;
  body: string;
  durationMs: number;
}

export interface ActorMeta {
  adminId: number;
  ip: string | null;
  userAgent: string | null;
}

const TEST_TIMEOUT_MS = 10_000;
/** Don't paste a whole HTML error page into the result panel. */
const MAX_BODY_CHARS = 4000;

@Injectable()
export class AdminWebhookService implements OnModuleInit {
  private readonly logger = new Logger(AdminWebhookService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
  ) {}

  /** Mirrors the legacy page's self-creating table, so no manual SQL is needed. */
  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS webhook_configs (
          id int(11) NOT NULL AUTO_INCREMENT,
          endpoint_url varchar(500) DEFAULT NULL COMMENT 'URL ปลายทาง',
          auth_token varchar(500) DEFAULT NULL COMMENT 'Bearer Token หรือ API Key',
          is_active tinyint(1) DEFAULT 0 COMMENT '1=เปิด, 0=ปิด',
          updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await this.dataSource.query(
        'INSERT IGNORE INTO webhook_configs (id, is_active) VALUES (1, 0)',
      );
    } catch (err) {
      this.logger.warn(`webhook_configs bootstrap skipped: ${String(err)}`);
    }
  }

  async get(): Promise<WebhookConfig> {
    try {
      const rows = await this.dataSource.query<
        Array<{
          endpointUrl: string | null;
          authToken: string | null;
          isActive: number;
          updatedAt: string | null;
        }>
      >(
        `SELECT endpoint_url AS endpointUrl, auth_token AS authToken,
                is_active AS isActive, updated_at AS updatedAt
           FROM webhook_configs WHERE id = 1`,
      );
      const row = rows[0];
      if (!row) return { endpointUrl: '', authToken: '', isActive: false, updatedAt: null };

      return {
        endpointUrl: row.endpointUrl ?? '',
        authToken: row.authToken ?? '',
        isActive: Number(row.isActive) === 1,
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      this.logger.warn(`webhook config read failed: ${String(err)}`);
      return { endpointUrl: '', authToken: '', isActive: false, updatedAt: null };
    }
  }

  async save(dto: SaveWebhookDto, actor: ActorMeta): Promise<void> {
    if (dto.endpointUrl) this.assertUsableUrl(dto.endpointUrl);

    // Turning it on without a destination would silently do nothing.
    if (dto.isActive && !dto.endpointUrl) {
      throw new BadRequestException('กรุณาระบุ Endpoint URL ก่อนเปิดใช้งาน Webhook');
    }

    await this.dataSource.query(
      'UPDATE webhook_configs SET endpoint_url = ?, auth_token = ?, is_active = ? WHERE id = 1',
      [dto.endpointUrl || null, dto.authToken || null, dto.isActive ? 1 : 0],
    );

    await this.writeLog(actor, JSON.stringify({ endpoint: dto.endpointUrl, isActive: dto.isActive }));
  }

  async test(dto: TestWebhookDto): Promise<WebhookTestResult> {
    this.assertUsableUrl(dto.endpointUrl);

    const payload = {
      event: 'order.created',
      timestamp: new Date().toISOString(),
      data: {
        order_number: 'TEST-9999',
        shop_code: 'S2606TEST',
        table_number: 'T-01',
        total_amount: 450.0,
        items: [
          { name: 'ก๋วยเตี๋ยวเรือเนื้อตุ๋น', qty: 2, price: 150.0 },
          { name: 'แคบหมู', qty: 1, price: 150.0 },
        ],
      },
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (dto.authToken) headers.Authorization = `Bearer ${dto.authToken}`;

    const startedAt = Date.now();
    try {
      const res = await fetch(dto.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });

      const body = (await res.text()).slice(0, MAX_BODY_CHARS);
      return {
        status: res.status >= 200 && res.status < 300 ? 'success' : 'error',
        code: res.status,
        body: body || '(ปลายทางตอบกลับมาแบบไม่มีเนื้อหา)',
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        code: 0,
        body:
          err instanceof Error && err.name === 'TimeoutError'
            ? `ปลายทางไม่ตอบกลับภายใน ${TEST_TIMEOUT_MS / 1000} วินาที`
            : `เชื่อมต่อไม่สำเร็จ: ${message}`,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * The legacy page passed the URL straight to cURL, which also speaks file://,
   * gopher:// and more — an admin typo or a pasted link could read server files.
   * Only real outbound webhook protocols are allowed.
   */
  private assertUsableUrl(raw: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('กรุณาระบุ Endpoint URL ให้ถูกต้อง');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Endpoint URL รองรับเฉพาะ http:// และ https:// เท่านั้น');
    }
  }

  private async writeLog(actor: ActorMeta, newValue: string): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'system.webhook_update',
          targetType: 'webhook_configs',
          targetId: 1,
          // The auth token is never written to the log.
          newValue,
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        }),
      );
    } catch (err) {
      this.logger.warn(`audit_log write failed (system.webhook_update): ${String(err)}`);
    }
  }
}
