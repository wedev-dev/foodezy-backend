import { Module } from '@nestjs/common';
import { ShopPosModule } from '../shop-pos/shop-pos.module';
import { CustomerOrderController } from './customer-order.controller';

@Module({
  imports: [ShopPosModule],
  controllers: [CustomerOrderController],
})
export class CustomerOrderModule {}
