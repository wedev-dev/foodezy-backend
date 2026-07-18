import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveOptionGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อกลุ่มออฟชั่น' })
  @MaxLength(150, { message: 'ชื่อกลุ่มออฟชั่นยาวเกินไป' })
  name!: string;

  // single = เลือกได้ 1 · multiple = เลือกได้หลายอัน
  @IsIn(['single', 'multiple'], { message: 'ประเภทการเลือกไม่ถูกต้อง' })
  selectionType!: 'single' | 'multiple';

  @IsBoolean()
  isRequired!: boolean;

  @IsInt({ message: 'ลำดับต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(100000)
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}
