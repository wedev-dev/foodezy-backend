import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface PackageOption {
  id: number;
  name: string;
  priceMonthly: number;
  maxTables: number;
  isCurrent: boolean;
  proratedPrice: number; // ราคาที่ต้องจ่ายจริงหลังหักเครดิตวันที่เหลือ
}
export interface PackagesResult {
  currentPackageId: number | null;
  creditRemaining: number; // เครดิตจากวันที่เหลือของแพ็กเกจปัจจุบัน
  daysRemaining: number | null;
  hasPending: boolean;
  packages: PackageOption[];
}

const CYCLE_DAYS = 30;

@Injectable()
export class ShopBillingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  private toDate(v: string | Date | null): Date | null {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const d = new Date(String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** เครดิตจากวันที่เหลือของแพ็กเกจปัจจุบัน (ถ้าเป็น Trial/ฟรี = 0) */
  private async currentCredit(shopId: number): Promise<{ credit: number; daysRemaining: number | null; packageId: number | null }> {
    const rows = await this.dataSource.query<Array<{
      packageId: number | null; price: string | null;
      trialEndAt: string | Date | null; packageStartAt: string | Date | null; packageEndAt: string | Date | null;
    }>>(
      `SELECT s.package_id AS packageId, p.price_monthly AS price,
              s.trial_end_at AS trialEndAt, s.package_start_at AS packageStartAt, s.package_end_at AS packageEndAt
         FROM shops s LEFT JOIN packages p ON p.id = s.package_id
        WHERE s.id = ?`,
      [shopId],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('ไม่พบข้อมูลร้าน');

    const isTrial = Number(r.packageId) === 1 || (!r.packageStartAt && !!r.trialEndAt);
    const endDate = this.toDate(isTrial ? r.trialEndAt : r.packageEndAt);
    let daysRemaining: number | null = null;
    if (endDate) daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86_400_000));

    const price = r.price != null ? Number(r.price) : 0;
    // Trial หรือแพ็กเกจฟรี => ไม่มีเครดิต (ไม่เคยจ่ายเงินมา)
    const credit = isTrial || price <= 0 || daysRemaining == null
      ? 0
      : Math.round((price / CYCLE_DAYS) * daysRemaining);

    return { credit, daysRemaining, packageId: r.packageId != null ? Number(r.packageId) : null };
  }

  async packages(shopId: number): Promise<PackagesResult> {
    const { credit, daysRemaining, packageId } = await this.currentCredit(shopId);

    const pkgs = await this.dataSource.query<Array<{ id: number; name: string; price: string; maxTables: number }>>(
      `SELECT id, name, price_monthly AS price, max_tables AS maxTables
         FROM packages WHERE is_active = 1 ORDER BY price_monthly ASC`,
    );

    const hasPending = await this.hasPending(shopId);

    return {
      currentPackageId: packageId,
      creditRemaining: credit,
      daysRemaining,
      hasPending,
      packages: pkgs.map((p) => {
        const price = Number(p.price);
        return {
          id: Number(p.id),
          name: p.name,
          priceMonthly: price,
          maxTables: Number(p.maxTables),
          isCurrent: Number(p.id) === packageId,
          proratedPrice: Math.max(0, Math.round(price - credit)),
        };
      }),
    };
  }

  private async hasPending(shopId: number): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ c: number }>>(
      `SELECT COUNT(*) AS c FROM shop_billing_history WHERE shop_id = ? AND status = 'pending'`,
      [shopId],
    );
    return Number(rows[0]?.c ?? 0) > 0;
  }

  async myPending(shopId: number): Promise<{ pending: boolean; packageName?: string; amount?: number; createdAt?: string }> {
    const rows = await this.dataSource.query<Array<{ amount: string; createdAt: string; packageName: string }>>(
      `SELECT b.amount, b.created_at AS createdAt, p.name AS packageName
         FROM shop_billing_history b JOIN packages p ON p.id = b.package_id
        WHERE b.shop_id = ? AND b.status = 'pending'
        ORDER BY b.id DESC LIMIT 1`,
      [shopId],
    );
    const r = rows[0];
    if (!r) return { pending: false };
    return { pending: true, packageName: r.packageName, amount: Number(r.amount), createdAt: String(r.createdAt) };
  }

  async createRequest(
    shopId: number,
    packageId: number,
    slip: { filename: string } | undefined,
  ): Promise<{ amount: number; packageName: string }> {
    if (!packageId) throw new BadRequestException('กรุณาเลือกแพ็กเกจ');
    if (!slip) throw new BadRequestException('กรุณาแนบสลิปการโอนเงิน');
    if (await this.hasPending(shopId)) {
      throw new BadRequestException('มีคำขอที่รอการอนุมัติอยู่แล้ว กรุณารอผู้ดูแลตรวจสอบ');
    }

    const pkgRows = await this.dataSource.query<Array<{ id: number; name: string; price: string }>>(
      `SELECT id, name, price_monthly AS price FROM packages WHERE id = ? AND is_active = 1`,
      [packageId],
    );
    const pkg = pkgRows[0];
    if (!pkg) throw new BadRequestException('ไม่พบแพ็กเกจที่เลือก');

    // คำนวณราคาจริงฝั่งเซิร์ฟเวอร์ (ไม่เชื่อค่าจากฝั่ง client)
    const { credit } = await this.currentCredit(shopId);
    const amount = Math.max(0, Math.round(Number(pkg.price) - credit));

    const prefix = this.config.get<string>('UPLOAD_URL_PREFIX', '/uploads');
    const slipUrl = `${prefix}/${slip.filename}`;

    await this.dataSource.query(
      `INSERT INTO shop_billing_history
         (shop_id, package_id, amount, billing_month, slip_url, status, note, created_at)
       VALUES (?, ?, ?, DATE_FORMAT(NOW(), '%Y-%m-01'), ?, 'pending', ?, NOW())`,
      [shopId, packageId, amount, slipUrl, `ขอเปลี่ยนเป็นแพ็กเกจ ${pkg.name}`],
    );

    return { amount, packageName: pkg.name };
  }
}
