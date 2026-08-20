import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { RequestWithShop, ShopAuthGuard } from '../shop-auth/guards/shop-auth.guard';
import {
  BestSeller,
  DashboardSummary,
  ShopDashboardService,
  StatRange,
} from './shop-dashboard.service';

@Controller('shop/dashboard')
@UseGuards(ShopAuthGuard)
export class ShopDashboardController {
  constructor(private readonly dashboard: ShopDashboardService) {}

  @Get('summary')
  async summary(@Req() req: RequestWithShop): Promise<{ success: true; data: DashboardSummary }> {
    return { success: true, data: await this.dashboard.summary(req.shop!.shopId) };
  }

  @Get('best-sellers')
  async bestSellers(
    @Req() req: RequestWithShop,
    @Query('range') range?: string,
  ): Promise<{ success: true; data: BestSeller[] }> {
    const r: StatRange = range === '7d' || range === 'month' ? range : 'today';
    return { success: true, data: await this.dashboard.bestSellers(req.shop!.shopId, r) };
  }
}
