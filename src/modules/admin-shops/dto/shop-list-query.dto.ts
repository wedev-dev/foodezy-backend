import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ShopListQueryDto {
  /** Omit for "all shops" — the combined list page uses this for its tabs. */
  @IsOptional()
  @IsIn(['pending', 'active', 'suspended', 'rejected'], { message: 'สถานะไม่ถูกต้อง' })
  status?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === undefined || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  page?: number;
}
