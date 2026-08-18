import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class OptionItemDto {
  @IsString() @IsNotEmpty({ message: 'กรุณากรอกชื่อตัวเลือก' }) @MaxLength(150) name!: string;
  @IsOptional() @IsNumber() priceAdjustment?: number;
}

export class OptionGroupDto {
  @IsString() @IsNotEmpty({ message: 'กรุณากรอกชื่อกลุ่มตัวเลือก' }) @MaxLength(150) name!: string;
  @IsIn(['single', 'multiple']) selectionType!: 'single' | 'multiple';
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) minSelect?: number;
  @IsOptional() @IsInt() @Min(0) maxSelect?: number;
  @IsArray() @ArrayMinSize(1, { message: 'ต้องมีตัวเลือกอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true }) @Type(() => OptionItemDto)
  items!: OptionItemDto[];
}

export class SyncGroupsDto {
  @IsOptional() @IsArray() groupIds?: number[];
}
