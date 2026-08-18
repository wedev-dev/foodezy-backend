import {
  Body, Controller, Get, HttpCode, Put, Req, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  RequireShopPermission, RequestWithShop, ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { ShopSettings, ShopSettingsService, UploadedLogo } from './shop-settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('shop/settings')
@UseGuards(ShopAuthGuard)
export class ShopSettingsController {
  constructor(private readonly settings: ShopSettingsService) {}

  @Get()
  @RequireShopPermission('shop_settings_manage')
  async get(@Req() req: RequestWithShop): Promise<{ success: true; data: ShopSettings }> {
    return { success: true, data: await this.settings.getSettings(req.shop!.shopId) };
  }

  @Put()
  @RequireShopPermission('shop_settings_manage')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'logo', maxCount: 1 }]))
  async update(
    @Req() req: RequestWithShop,
    @Body() dto: UpdateSettingsDto,
    @UploadedFiles() files: UploadedLogo,
  ): Promise<{ success: true; data: ShopSettings }> {
    return {
      success: true,
      data: await this.settings.updateSettings(req.shop!.shopId, dto, files ?? {}),
    };
  }
}
