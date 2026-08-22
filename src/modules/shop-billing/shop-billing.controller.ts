import { Body, Controller, Get, Post, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ShopAuthGuard, RequestWithShop } from '../shop-auth/guards/shop-auth.guard';
import { ShopBillingService, PackagesResult } from './shop-billing.service';

const slipUpload = FileFieldsInterceptor([{ name: 'slip', maxCount: 1 }]);

@Controller('shop/billing')
@UseGuards(ShopAuthGuard)
export class ShopBillingController {
  constructor(private readonly billing: ShopBillingService) {}

  @Get('packages')
  async packages(@Req() req: RequestWithShop): Promise<{ success: true; data: PackagesResult }> {
    return { success: true, data: await this.billing.packages(req.shop!.shopId) };
  }

  @Get('pending')
  async pending(@Req() req: RequestWithShop): Promise<{ success: true; data: Awaited<ReturnType<ShopBillingService['myPending']>> }> {
    return { success: true, data: await this.billing.myPending(req.shop!.shopId) };
  }

  @Post('request')
  @UseInterceptors(slipUpload)
  async request(
    @Req() req: RequestWithShop,
    @Body() body: { packageId?: string },
    @UploadedFiles() files: { slip?: Array<{ filename: string }> },
  ): Promise<{ success: true; data: { amount: number; packageName: string } }> {
    const data = await this.billing.createRequest(
      req.shop!.shopId,
      Number(body.packageId),
      files?.slip?.[0],
    );
    return { success: true, data };
  }
}
