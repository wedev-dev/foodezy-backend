import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveOptionItemDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อตัวเลือก' })
  @MaxLength(200, { message: 'ชื่อตัวเลือกยาวเกินไป' })
  name!: string;

  // Extra price added to the dish. Negative is allowed so an option can also
  // discount (e.g. "ไม่ใส่เนื้อ -10").
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ราคาต้องเป็นตัวเลข' })
  @Min(-99999.99)
  @Max(99999.99)
  extraPrice!: number;

  @IsInt({ message: 'ลำดับต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(100000)
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}
