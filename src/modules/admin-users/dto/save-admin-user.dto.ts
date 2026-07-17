import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The modules mainmenu.php gates on. */
export const PERMISSION_KEYS = ['shops', 'billing', 'menus', 'system'] as const;

export class SaveAdminUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ดูแลระบบ' })
  @MaxLength(150)
  adminName!: string;

  @Transform(trim)
  @Matches(/^[a-zA-Z0-9._-]{3,50}$/, {
    message: 'Username ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดล่าง, ขีดกลาง (3-50 ตัว)',
  })
  username!: string;

  /** Required on create; blank on update means "leave the password alone". */
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' })
  @MaxLength(100)
  password?: string;

  @IsIn(['all', 'custom'], { message: 'ประเภทสิทธิ์ไม่ถูกต้อง' })
  accessType!: 'all' | 'custom';

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_KEYS as unknown as string[], { each: true, message: 'สิทธิ์ไม่ถูกต้อง' })
  perms?: string[];

  @IsIn(['99999', '00000'], { message: 'สถานะไม่ถูกต้อง' })
  status!: string;
}
