import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class StaffDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'กรุณากรอกชื่อพนักงาน' }) @MaxLength(150) name!: string;

  @Transform(trim) @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก' }) phone!: string;

  // เพิ่มใหม่: ต้องมีรหัสผ่าน / แก้ไข: เว้นว่าง = ไม่เปลี่ยน
  @IsOptional() @IsString() @MinLength(6, { message: 'รหัสผ่านอย่างน้อย 6 ตัว' }) @MaxLength(72) password?: string;

  @IsOptional() @IsBoolean() isSuperadmin?: boolean;

  @IsOptional() @IsArray() permissionIds?: number[];
}
