import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Trim helper — values arrive as multipart strings. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterShopDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อร้านค้า' })
  @MaxLength(200)
  shopName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อเจ้าของร้าน' })
  @MaxLength(150)
  ownerName!: string;

  // Strip spaces/dashes then require a Thai-style phone (0 + 8-9 digits).
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[-\s]/g, '') : value,
  )
  @Matches(/^0\d{8,9}$/, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' })
  phone!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'อีเมลไม่ถูกต้อง' })
  @MaxLength(150)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  @MaxLength(255)
  password!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  address?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(13)
  taxId?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(13)
  ownerId?: string;

  // Matches the `packages` table: 1=Trial, 2=Pro, 3=Premium.
  @IsInt()
  @Min(1)
  packageId: number = 1;

  @IsIn(['qr_only', 'staff_only', 'both'])
  orderMode: string = 'qr_only';

  @IsIn(['screen', 'printer', 'both'])
  kitchenOutput: string = 'screen';

  @IsIn(['per_item', 'buffet'])
  billingType: string = 'per_item';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === undefined || value === null ? undefined : Number(value),
  )
  @Min(0)
  buffetPrice?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  printerIp?: string;
}
