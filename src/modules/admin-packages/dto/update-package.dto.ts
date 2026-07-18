import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, Max, Min, ValidateNested } from 'class-validator';

/** feature flags persisted as JSON in packages.features */
export class PackageFeaturesDto {
  @IsBoolean()
  inventory!: boolean;

  @IsBoolean()
  analytics!: boolean;
}

/**
 * The three packages (Trial/Pro/Premium) are fixed rows the rest of the system
 * keys off by id, so only their terms are editable — never create/delete.
 *
 * Upper bounds match the column types (smallint / tinyint) so an oversized
 * value is rejected with a clear message instead of overflowing under strict
 * mode.
 */
export class UpdatePackageDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ราคาต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาต้องไม่ติดลบ' })
  @Max(99999999.99, { message: 'ราคาสูงเกินไป' })
  priceMonthly!: number;

  @IsInt({ message: 'จำนวนโต๊ะต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(32767, { message: 'จำนวนโต๊ะสูงเกินไป' })
  maxTables!: number;

  @IsInt({ message: 'จำนวนเมนูต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(32767, { message: 'จำนวนเมนูสูงเกินไป' })
  maxMenuItems!: number;

  /** 0 = unlimited */
  @IsInt({ message: 'ลิมิตออเดอร์ต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(32767, { message: 'ลิมิตออเดอร์สูงเกินไป' })
  dailyOrderLimit!: number;

  @IsInt({ message: 'จำนวนวันทดลองต้องเป็นจำนวนเต็ม' })
  @Min(0)
  @Max(127, { message: 'จำนวนวันทดลองสูงเกินไป' })
  trialDays!: number;

  @ValidateNested()
  @Type(() => PackageFeaturesDto)
  features!: PackageFeaturesDto;

  @IsBoolean()
  isActive!: boolean;
}
