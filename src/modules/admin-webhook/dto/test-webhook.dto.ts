import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class TestWebhookDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ Endpoint URL ให้ถูกต้องก่อนทำการทดสอบ' })
  @MaxLength(500)
  endpointUrl!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  authToken?: string;
}
