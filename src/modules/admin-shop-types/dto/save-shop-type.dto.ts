import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveShopTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อประเภทร้านค้า' })
  @MaxLength(100, { message: 'ชื่อประเภทร้านค้ายาวเกินไป' })
  name!: string;

  @IsBoolean()
  isActive!: boolean;
}
