import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAnnouncementDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกหัวข้อประกาศ' })
  @MaxLength(255)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกเนื้อหาประกาศ' })
  @MaxLength(20000)
  message!: string;

  @IsIn(['all', 'trial', 'pro'], { message: 'กลุ่มเป้าหมายไม่ถูกต้อง' })
  targetGroup!: string;

  /** false stores a draft: saved but not delivered to any shop. */
  @IsBoolean()
  publish!: boolean;
}
