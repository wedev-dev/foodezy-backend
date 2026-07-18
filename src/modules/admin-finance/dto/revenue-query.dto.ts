import { IsOptional, IsString, Matches } from 'class-validator';

export class RevenueQueryDto {
  /** YYYY-MM; anything else falls back to the current month. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'รูปแบบเดือนไม่ถูกต้อง' })
  month?: string;
}
