import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class HistoryQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === undefined || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  page?: number;
}
