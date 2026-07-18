import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveCallStaffDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อหัวข้อ' })
  @MaxLength(100, { message: 'ชื่อหัวข้อยาวเกินไป' })
  title!: string;

  @IsBoolean()
  isActive!: boolean;
}
