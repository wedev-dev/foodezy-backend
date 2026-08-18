import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateSettingsDto {
  @Transform(trim) @IsString() @MaxLength(200) name!: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) email?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) ownerName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(13) taxId?: string;

  @IsOptional() @Transform(trim) @IsString()
  @Matches(/^(\d{10}|\d{13})?$/, { message: 'PromptPay ต้องเป็นเบอร์ 10 หลัก หรือเลขบัตร 13 หลัก' })
  promptpayNumber?: string;

  @IsOptional() @IsIn(['0', '1']) isOpen?: string;

  @IsOptional() @IsIn(['qr_only', 'staff_only', 'both']) orderMode?: string;
  @IsOptional() @IsIn(['screen', 'printer', 'both']) kitchenOutput?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) printerIp?: string;

  @IsOptional() @IsIn(['per_item', 'buffet']) billingType?: string;
  @ValidateIf((o) => o.billingType === 'buffet')
  @IsOptional() @Transform(trim) @IsString()
  @Matches(/^\d{1,6}(\.\d{1,2})?$/, { message: 'ราคาบุฟเฟ่ต์ไม่ถูกต้อง' })
  buffetPricePerHead?: string;

  @IsOptional() @IsIn(['58mm', '80mm']) paperSize?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) receiptFont?: string;

  @IsOptional() @IsIn(['0', '1']) removeLogo?: string;
}
