import { Module } from '@nestjs/common';
import { ShopAuthModule } from '../shop-auth/shop-auth.module';
import { ShopReportsController } from './shop-reports.controller';
import { ShopReportsService } from './shop-reports.service';

@Module({
  imports: [ShopAuthModule],
  controllers: [ShopReportsController],
  providers: [ShopReportsService],
})
export class ShopReportsModule {}
