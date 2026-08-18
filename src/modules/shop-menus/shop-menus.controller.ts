import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put,
  Req, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  RequireShopPermission, RequestWithShop, ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { Category, MenuRow, ShopMenusService, UploadedImage } from './shop-menus.service';
import { MenuDto, ToggleDto } from './dto/menu.dto';

const imageUpload = FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]);

@Controller('shop/menus')
@UseGuards(ShopAuthGuard)
export class ShopMenusController {
  constructor(private readonly menus: ShopMenusService) {}

  @Get()
  @RequireShopPermission('menu_manage')
  async list(@Req() req: RequestWithShop): Promise<{ success: true; data: { categories: Category[]; menus: MenuRow[] } }> {
    return { success: true, data: await this.menus.list(req.shop!.shopId) };
  }

  @Post()
  @RequireShopPermission('menu_manage')
  @UseInterceptors(imageUpload)
  async create(
    @Req() req: RequestWithShop,
    @Body() dto: MenuDto,
    @UploadedFiles() files: UploadedImage,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.menus.create(req.shop!.shopId, dto, files ?? {}) };
  }

  @Put(':id')
  @RequireShopPermission('menu_manage')
  @UseInterceptors(imageUpload)
  async update(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MenuDto,
    @UploadedFiles() files: UploadedImage,
  ): Promise<{ success: true }> {
    await this.menus.update(req.shop!.shopId, id, dto, files ?? {});
    return { success: true };
  }

  @Patch(':id/available')
  @RequireShopPermission('menu_manage')
  async toggle(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleDto,
  ): Promise<{ success: true }> {
    await this.menus.toggle(req.shop!.shopId, id, dto.isAvailable === '1');
    return { success: true };
  }

  @Delete(':id')
  @RequireShopPermission('menu_manage')
  async remove(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true }> {
    await this.menus.remove(req.shop!.shopId, id);
    return { success: true };
  }
}
