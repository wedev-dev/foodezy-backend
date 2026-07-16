import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

const toOptionalInt = ({ value }: { value: unknown }): unknown =>
  value === '' || value === undefined || value === null ? undefined : Number(value);

export class AuditLogQueryDto {
  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  adminId?: number;

  /** Category prefix, matching the legacy dropdown (action LIKE 'shop%'). */
  @IsOptional()
  @IsIn(['shop', 'billing', 'admin', 'menu'])
  action?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  dateStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  dateEnd?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  page?: number;
}
