import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { RequestWithShop, ShopAuthGuard } from '../shop-auth/guards/shop-auth.guard';
import { DashboardSummary, ShopDashboardService } from './shop-dashboard.service';

@Controller('shop/dashboard')
@UseGuards(ShopAuthGuard)
export class ShopDashboardController {
  constructor(private readonly dashboard: ShopDashboardService) {}

  @Get('summary')
  async summary(@Req() req: RequestWithShop): Promise<{ success: true; data: DashboardSummary }> {
    return { success: true, data: await this.dashboard.summary(req.shop!.shopId) };
  }
}
