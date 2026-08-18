import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class MenuDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'กรุณากรอกชื่อเมนู' }) @MaxLength(200)
  name!: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;

  @Transform(trim) @Matches(/^\d+$/, { message: 'หมวดหมู่ไม่ถูกต้อง' }) categoryId!: string;

  @IsOptional() @Transform(trim) @Matches(/^\d{1,6}(\.\d{1,2})?$/, { message: 'ราคาไม่ถูกต้อง' })
  price?: string;

  @IsOptional() @IsIn(['0', '1']) isAvailable?: string;
  @IsOptional() @IsIn(['0', '1']) isRecommended?: string;
  @IsOptional() @Transform(trim) @Matches(/^\d{1,4}$/) sortOrder?: string;
  @IsOptional() @IsIn(['normal', 'buffet_included', 'buffet_addon']) menuPricingType?: string;
  @IsOptional() @IsIn(['0', '1']) removeImage?: string;
  @IsOptional() @IsString() optionGroupIds?: string; // JSON array เช่น "[1,2]"
}

export class ToggleDto {
  @IsIn(['0', '1']) isAvailable!: string;
}
