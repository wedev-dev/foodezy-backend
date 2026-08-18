import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import {
  RequireShopPermission, RequestWithShop, ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { LibraryGroup, OptionGroup, ShopOptionsService } from './shop-options.service';
import { OptionGroupDto, SyncGroupsDto } from './dto/option.dto';

@Controller('shop/options')
@UseGuards(ShopAuthGuard)
export class ShopOptionsController {
  constructor(private readonly options: ShopOptionsService) {}

  @Get()
  @RequireShopPermission('menu_manage')
  async list(@Req() req: RequestWithShop): Promise<{ success: true; data: OptionGroup[] }> {
    return { success: true, data: await this.options.list(req.shop!.shopId) };
  }

  @Get('library')
  @RequireShopPermission('menu_manage')
  async library(@Req() req: RequestWithShop): Promise<{ success: true; data: LibraryGroup[] }> {
    return { success: true, data: await this.options.library(req.shop!.shopId) };
  }

  @Post()
  @RequireShopPermission('menu_manage')
  async create(@Req() req: RequestWithShop, @Body() dto: OptionGroupDto): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.options.create(req.shop!.shopId, dto) };
  }

  @Put(':id')
  @RequireShopPermission('menu_manage')
  async update(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number, @Body() dto: OptionGroupDto): Promise<{ success: true }> {
    await this.options.update(req.shop!.shopId, id, dto);
    return { success: true };
  }

  @Delete(':id')
  @RequireShopPermission('menu_manage')
  async remove(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.options.remove(req.shop!.shopId, id);
    return { success: true };
  }

  @Post('sync')
  @RequireShopPermission('menu_manage')
  async sync(@Req() req: RequestWithShop, @Body() dto: SyncGroupsDto): Promise<{ success: true; data: { added: number } }> {
    const ids = Array.isArray(dto.groupIds) && dto.groupIds.length ? dto.groupIds.map(Number) : null;
    return { success: true, data: await this.options.syncFromGlobal(req.shop!.shopId, ids) };
  }
}
