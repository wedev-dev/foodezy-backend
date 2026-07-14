import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { RegisterShopDto } from './dto/register-shop.dto';
import { AuditLog } from './entities/audit-log.entity';
import {
  BillingType,
  KitchenOutput,
  OrderMode,
  Shop,
} from './entities/shop.entity';

export interface UploadedShopImages {
  shopFront?: Express.Multer.File[];
  shopInside?: Express.Multer.File[];
}

export interface RegisterMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface RegisterResult {
  shopId: number;
  shopCode: string;
  trialEndAt: Date;
}

const TRIAL_DAYS = 30;

@Injectable()
export class ShopsService {
  private readonly logger = new Logger(ShopsService.name);
  private readonly urlPrefix: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.urlPrefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
  }

  async register(
    dto: RegisterShopDto,
    files: UploadedShopImages,
    meta: RegisterMeta,
  ): Promise<RegisterResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.assertEmailAvailable(manager, dto.email);

        const now = new Date();
        const trialEndAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

        const shop = manager.create(Shop, {
          packageId: dto.packageId,
          shopCode: 'PENDING', // replaced with an id-based code right after insert
          name: dto.shopName,
          phone: dto.phone,
          email: dto.email,
          password: this.preparePassword(dto.password),
          address: dto.address ?? null,
          taxId: dto.taxId ?? null,
          ownerName: dto.ownerName,
          ownerIdCard: dto.ownerId ?? null,
          status: 'pending',
          trialStartAt: now,
          trialEndAt,
          shopFrontUrl: this.toUrl(files.shopFront),
          shopInsideUrl: this.toUrl(files.shopInside),
          kitchenOutput: dto.kitchenOutput as KitchenOutput,
          printerIp: dto.printerIp ?? null,
          orderMode: dto.orderMode as OrderMode,
          billingType: dto.billingType as BillingType,
          buffetPricePerHead:
            dto.billingType === 'buffet' && dto.buffetPrice !== undefined
              ? dto.buffetPrice.toFixed(2)
              : null,
        });

        const saved = await manager.save(shop);

        // shop_code derived from the real PK → guaranteed unique, no race.
        saved.shopCode = this.buildShopCode(saved.id, now);
        await manager.save(saved);

        await this.writeAuditLog(manager, saved.id, meta);

        return { shopId: saved.id, shopCode: saved.shopCode, trialEndAt };
      });
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      // Never leak DB internals to the client (the old PHP returned e.getMessage()).
      this.logger.error('Shop registration failed', err as Error);
      throw new InternalServerErrorException('เกิดข้อผิดพลาดระบบ กรุณาลองใหม่');
    }
  }

  private async assertEmailAvailable(
    manager: EntityManager,
    email: string,
  ): Promise<void> {
    const existing = await manager.findOne(Shop, {
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('อีเมลนี้มีในระบบแล้ว กรุณาใช้อีเมลอื่น');
    }
  }

  private async writeAuditLog(
    manager: EntityManager,
    shopId: number,
    meta: RegisterMeta,
  ): Promise<void> {
    // Audit failure must not roll back the registration.
    try {
      const log = manager.create(AuditLog, {
        actorType: 'system',
        actorId: null,
        action: 'shop.self_register',
        targetType: 'shops',
        targetId: shopId,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      await manager.save(log);
    } catch (err) {
      this.logger.warn(`audit_log write failed for shop ${shopId}: ${String(err)}`);
    }
  }

  private toUrl(files?: Express.Multer.File[]): string | null {
    const file = files?.[0];
    return file ? `${this.urlPrefix}/${file.filename}` : null;
  }

  private buildShopCode(id: number, now: Date): string {
    const yy = String(now.getFullYear()).slice(-2);
    return `S${yy}${id.toString(36).toUpperCase().padStart(4, '0')}`;
  }

  /**
   * Single place where the password is prepared before storage.
   * Currently plain text (compat with existing admin login).
   * To harden later: `return bcrypt.hashSync(plain, 10);`
   */
  private preparePassword(plain: string): string {
    return plain;
  }
}
