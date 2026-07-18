import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class OwnerLoginDto {
  @Transform(trim)
  @Matches(/^\d{10}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก' })
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสผ่าน' })
  @MaxLength(100)
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean = false;
}
