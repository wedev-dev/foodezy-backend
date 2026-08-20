import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  RequireShopPermission,
  RequestWithShop,
  ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { ReportData, ReportRange, ShopReportsService } from './shop-reports.service';

@Controller('shop/reports')
@UseGuards(ShopAuthGuard)
export class ShopReportsController {
  constructor(private readonly reports: ShopReportsService) {}

  @Get()
  @RequireShopPermission('report_view')
  async report(
    @Req() req: RequestWithShop,
    @Query('range') range?: string,
  ): Promise<{ success: true; data: ReportData }> {
    const r: ReportRange = range === '30d' || range === 'month' ? range : '7d';
    return { success: true, data: await this.reports.report(req.shop!.shopId, r) };
  }
}
