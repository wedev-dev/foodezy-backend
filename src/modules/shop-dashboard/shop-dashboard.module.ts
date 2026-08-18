import { Module } from '@nestjs/common';
import { ShopAuthModule } from '../shop-auth/shop-auth.module';
import { ShopDashboardController } from './shop-dashboard.controller';
import { ShopDashboardService } from './shop-dashboard.service';

@Module({
  imports: [ShopAuthModule],
  controllers: [ShopDashboardController],
  providers: [ShopDashboardService],
})
export class ShopDashboardModule {}
