import { IsIn } from 'class-validator';
import type { ShopStatus } from '../admin-shops.service';

export class UpdateShopStatusDto {
  @IsIn(['pending', 'active', 'suspended', 'rejected'], { message: 'สถานะไม่ถูกต้อง' })
  status!: ShopStatus;
}
