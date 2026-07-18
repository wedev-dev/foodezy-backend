import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveFoodCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อหมวดหมู่' })
  @MaxLength(100, { message: 'ชื่อหมวดหมู่ยาวเกินไป' })
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'ชื่อภาษาอังกฤษยาวเกินไป' })
  nameEn?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsInt({ message: 'ลำดับต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(32767, { message: 'ลำดับสูงเกินไป' })
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}
