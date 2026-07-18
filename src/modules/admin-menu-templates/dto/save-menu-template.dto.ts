import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Sent as multipart/form-data (an image may ride along), so numeric fields
 * arrive as strings and are coerced by the global ValidationPipe
 * (enableImplicitConversion). Array/boolean-ish fields are kept as strings and
 * parsed in the service, matching how SaveShopDto handles shop_type_ids.
 */
export class SaveMenuTemplateDto {
  @IsInt({ message: 'กรุณาเลือกหมวดหมู่' })
  @Min(1, { message: 'กรุณาเลือกหมวดหมู่' })
  categoryId!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อเมนู' })
  @MaxLength(200, { message: 'ชื่อเมนูยาวเกินไป' })
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'ชื่อภาษาอังกฤษยาวเกินไป' })
  nameEn?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000, { message: 'คำอธิบายยาวเกินไป' })
  description?: string;

  @IsOptional()
  @IsIn(['0', '1'], { message: 'สถานะไม่ถูกต้อง' })
  isActive?: string;

  /** JSON array of global_option_group ids, e.g. "[1,3,4]". */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  optionGroupIds?: string;

  /** '1' on edit = clear the existing image without uploading a new one. */
  @IsOptional()
  @IsIn(['0', '1'])
  removeImage?: string;
}
