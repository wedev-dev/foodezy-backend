import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateExpenseDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหมวดหมู่รายจ่าย' })
  @MaxLength(100)
  category!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  description?: string;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @Transform(trim)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  expenseDate!: string;
}
