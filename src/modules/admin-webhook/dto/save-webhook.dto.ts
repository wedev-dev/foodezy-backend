import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveWebhookDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  endpointUrl?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  authToken?: string;

  @IsBoolean()
  isActive!: boolean;
}
