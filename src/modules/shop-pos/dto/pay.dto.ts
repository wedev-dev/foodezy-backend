import { IsIn } from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'qr_promptpay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class PayDto {
  @IsIn(PAYMENT_METHODS as unknown as string[], { message: 'วิธีชำระเงินไม่ถูกต้อง' })
  method!: PaymentMethod;
}
