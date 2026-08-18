import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class TableDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) tableNumber?: string;
  @IsOptional() @Transform(trim) @Matches(/^\d{1,2}$/, { message: 'จำนวนที่นั่งไม่ถูกต้อง' }) seats?: string;
}
