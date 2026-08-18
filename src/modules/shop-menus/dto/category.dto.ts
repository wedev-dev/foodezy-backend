import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CategoryDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'กรุณากรอกชื่อหมวดหมู่' }) @MaxLength(100)
  name!: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) nameEn?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) icon?: string;
}

export class CloneTemplatesDto {
  @IsOptional()
  templateIds?: number[];
}
