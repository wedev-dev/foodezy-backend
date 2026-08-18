import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import {
  RequireShopPermission, RequestWithShop, ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { LibraryCategory, ShopCategoriesService, ShopCategory } from './shop-categories.service';
import { CategoryDto } from './dto/category.dto';

@Controller('shop/categories')
@UseGuards(ShopAuthGuard)
export class ShopCategoriesController {
  constructor(private readonly categories: ShopCategoriesService) {}

  @Get()
  @RequireShopPermission('menu_manage')
  async list(@Req() req: RequestWithShop): Promise<{ success: true; data: ShopCategory[] }> {
    return { success: true, data: await this.categories.list(req.shop!.shopId) };
  }

  @Get('library')
  @RequireShopPermission('menu_manage')
  async library(@Req() req: RequestWithShop): Promise<{ success: true; data: LibraryCategory[] }> {
    return { success: true, data: await this.categories.library(req.shop!.shopId) };
  }

  @Post()
  @RequireShopPermission('menu_manage')
  async add(@Req() req: RequestWithShop, @Body() dto: CategoryDto): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.categories.add(req.shop!.shopId, dto.name, dto.nameEn ?? null, dto.icon ?? null) };
  }

  @Put(':id')
  @RequireShopPermission('menu_manage')
  async update(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number, @Body() dto: CategoryDto): Promise<{ success: true }> {
    await this.categories.update(req.shop!.shopId, id, dto.name, dto.nameEn ?? null, dto.icon ?? null);
    return { success: true };
  }

  @Delete(':id')
  @RequireShopPermission('menu_manage')
  async remove(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.categories.remove(req.shop!.shopId, id);
    return { success: true };
  }

  @Post('sync')
  @RequireShopPermission('menu_manage')
  async sync(@Req() req: RequestWithShop): Promise<{ success: true; data: { added: number } }> {
    return { success: true, data: await this.categories.syncFromGlobal(req.shop!.shopId) };
  }
}
