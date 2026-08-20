import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @IsInt()
  @Min(1)
  menuId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  // ids ของ shop_option_items ที่ลูกค้า/พนักงานเลือก (อาจว่างได้ถ้าเมนูไม่มีออฟชั่น)
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  optionItemIds?: number[];
}

export class CreateOrderDto {
  @IsInt()
  @Min(1)
  tableId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
