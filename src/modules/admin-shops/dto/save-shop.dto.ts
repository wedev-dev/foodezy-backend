import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toInt = ({ value }: { value: unknown }): unknown =>
  value === '' || value === undefined || value === null ? undefined : Number(value);

/** Multipart sends everything as strings, so every non-string field is transformed. */
export class SaveShopDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อร้านค้า' })
  @MaxLength(200)
  name!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อเจ้าของร้าน' })
  @MaxLength(150)
  ownerName!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'อีเมลไม่ถูกต้อง' })
  @MaxLength(150)
  email!: string;

  @Transform(trim)
  @Matches(/^0\d{8,9}$/, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' })
  phone!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{13}$/, { message: 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' })
  taxId?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' })
  ownerIdCard?: string;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  packageId!: number;

  @IsIn(['pending', 'active', 'suspended', 'rejected'], { message: 'สถานะไม่ถูกต้อง' })
  status!: 'pending' | 'active' | 'suspended' | 'rejected';

  @IsOptional()
  @IsIn(['qr_only', 'staff_only', 'both'])
  orderMode?: string;

  @IsOptional()
  @IsIn(['screen', 'printer', 'both'])
  kitchenOutput?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  printerIp?: string;

  @IsOptional()
  @IsIn(['per_item', 'buffet'])
  billingType?: string;

  @IsOptional()
  @Transform(toInt)
  @IsNumber()
  @Min(0)
  buffetPricePerHead?: number;

  /** JSON array of shop_types ids, e.g. "[1,3]" — matches the legacy column format. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shopTypeIds?: string;

  @IsOptional()
  @IsIn(['0', '1'])
  deleteFrontFlag?: string;

  @IsOptional()
  @IsIn(['0', '1'])
  deleteInsideFlag?: string;
}
