import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { UpdateSettingsDto } from './dto/update-settings.dto';

export interface ShopSettings {
  name: string;
  shopCode: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  ownerName: string | null;
  taxId: string | null;
  promptpayNumber: string | null;
  logoUrl: string | null;
  isOpen: boolean;
  orderMode: 'qr_only' | 'staff_only' | 'both';
  kitchenOutput: 'screen' | 'printer' | 'both';
  printerIp: string | null;
  billingType: 'per_item' | 'buffet';
  buffetPricePerHead: number | null;
  paperSize: string;
  receiptFont: string;
}

export interface UploadedLogo {
  logo?: Array<{ filename: string }>;
}

@Injectable()
export class ShopSettingsService {
  private readonly logger = new Logger(ShopSettingsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async getSettings(shopId: number): Promise<ShopSettings> {
    const rows = await this.dataSource.query<
      Array<{
        name: string;
        shopCode: string;
        phone: string | null;
        email: string | null;
        address: string | null;
        ownerName: string | null;
        taxId: string | null;
        promptpayNumber: string | null;
        logoUrl: string | null;
        isOpen: number;
        orderMode: ShopSettings['orderMode'];
        kitchenOutput: ShopSettings['kitchenOutput'];
        printerIp: string | null;
        billingType: ShopSettings['billingType'];
        buffetPricePerHead: string | null;
        paperSize: string;
        receiptFont: string;
      }>
    >(
      `SELECT name, shop_code AS shopCode, phone, email, address,
              owner_name AS ownerName, tax_id AS taxId, promptpay_number AS promptpayNumber,
              logo_url AS logoUrl, is_open AS isOpen, order_mode AS orderMode,
              kitchen_output AS kitchenOutput, printer_ip AS printerIp, billing_type AS billingType,
              buffet_price_per_head AS buffetPricePerHead, paper_size AS paperSize, receipt_font AS receiptFont
         FROM shops WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [shopId],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('ไม่พบข้อมูลร้าน');

    return {
      name: r.name,
      shopCode: r.shopCode,
      phone: r.phone,
      email: r.email,
      address: r.address,
      ownerName: r.ownerName,
      taxId: r.taxId,
      promptpayNumber: r.promptpayNumber,
      logoUrl: r.logoUrl,
      isOpen: Number(r.isOpen) === 1,
      orderMode: r.orderMode,
      kitchenOutput: r.kitchenOutput,
      printerIp: r.printerIp,
      billingType: r.billingType,
      buffetPricePerHead: r.buffetPricePerHead === null ? null : Number(r.buffetPricePerHead),
      paperSize: r.paperSize,
      receiptFont: r.receiptFont,
    };
  }

  async updateSettings(
    shopId: number,
    dto: UpdateSettingsDto,
    files: UploadedLogo,
  ): Promise<ShopSettings> {
    const current = await this.getSettings(shopId);
    if (!dto.name || !dto.name.trim()) throw new BadRequestException('กรุณากรอกชื่อร้าน');

    const uploaded = this.fileUrl(files.logo?.[0]);
    let logoUrl = current.logoUrl;
    let logoToRemove: string | null = null;
    if (uploaded) {
      logoToRemove = current.logoUrl;
      logoUrl = uploaded;
    } else if (dto.removeLogo === '1') {
      logoToRemove = current.logoUrl;
      logoUrl = null;
    }

    const billingType = dto.billingType ?? current.billingType;
    const buffet =
      billingType === 'buffet'
        ? dto.buffetPricePerHead
          ? Number(dto.buffetPricePerHead)
          : current.buffetPricePerHead
        : null;

    await this.dataSource.query(
      `UPDATE shops SET
         name = ?, phone = ?, email = ?, address = ?, owner_name = ?, tax_id = ?,
         promptpay_number = ?, logo_url = ?, is_open = ?, order_mode = ?, kitchen_output = ?,
         printer_ip = ?, billing_type = ?, buffet_price_per_head = ?, paper_size = ?, receipt_font = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        dto.name.trim(),
        dto.phone || null,
        dto.email || current.email,
        dto.address || null,
        dto.ownerName || null,
        dto.taxId || null,
        dto.promptpayNumber || null,
        logoUrl,
        dto.isOpen === '0' ? 0 : 1,
        dto.orderMode ?? current.orderMode,
        dto.kitchenOutput ?? current.kitchenOutput,
        dto.printerIp || null,
        billingType,
        buffet,
        dto.paperSize ?? current.paperSize,
        dto.receiptFont || current.receiptFont,
        shopId,
      ],
    );

    await this.removeFile(logoToRemove);
    return this.getSettings(shopId);
  }

  private fileUrl(file: { filename: string } | undefined): string | null {
    if (!file) return null;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    return `${prefix}/${file.filename}`;
  }

  private async removeFile(url: string | null): Promise<void> {
    if (!url) return;
    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    if (!url.startsWith(`${prefix}/`)) return;
    const dir = this.config.get<string>('UPLOAD_DIR', './uploads');
    try {
      await unlink(join(dir, url.slice(prefix.length + 1)));
    } catch (err) {
      this.logger.warn(`could not delete ${url}: ${String(err)}`);
    }
  }
}
