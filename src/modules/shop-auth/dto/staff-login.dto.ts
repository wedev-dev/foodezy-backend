import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class StaffLoginDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสร้าน' })
  @MaxLength(30)
  shopCode!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ใช้' })
  @MaxLength(50)
  username!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสผ่าน' })
  @MaxLength(100)
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean = false;
}
