import { IsIn } from 'class-validator';

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'cooking',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ITEM_STATUSES = ['pending', 'cooking', 'ready', 'cancelled'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES as unknown as string[], { message: 'สถานะออเดอร์ไม่ถูกต้อง' })
  status!: OrderStatus;
}

export class UpdateItemStatusDto {
  @IsIn(ITEM_STATUSES as unknown as string[], { message: 'สถานะรายการไม่ถูกต้อง' })
  status!: ItemStatus;
}
