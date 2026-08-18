import { Module } from '@nestjs/common';
import { ShopAuthModule } from '../shop-auth/shop-auth.module';
import { ShopStaffController } from './shop-staff.controller';
import { ShopStaffService } from './shop-staff.service';

@Module({
  imports: [ShopAuthModule],
  controllers: [ShopStaffController],
  providers: [ShopStaffService],
})
export class ShopStaffModule {}
