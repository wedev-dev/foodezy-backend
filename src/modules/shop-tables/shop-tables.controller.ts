import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import {
  RequireShopPermission, RequestWithShop, ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { ShopTablesService, TableRow } from './shop-tables.service';
import { TableDto } from './dto/table.dto';

@Controller('shop/tables')
@UseGuards(ShopAuthGuard)
export class ShopTablesController {
  constructor(private readonly tables: ShopTablesService) {}

  @Get()
  @RequireShopPermission('table_manage')
  async list(@Req() req: RequestWithShop): Promise<{ success: true; data: TableRow[] }> {
    return { success: true, data: await this.tables.list(req.shop!.shopId) };
  }

  @Post()
  @RequireShopPermission('table_manage')
  async create(@Req() req: RequestWithShop, @Body() dto: TableDto): Promise<{ success: true; data: { id: number; tableNumber: string; qrToken: string } }> {
    return { success: true, data: await this.tables.create(req.shop!.shopId, dto) };
  }

  @Put(':id')
  @RequireShopPermission('table_manage')
  async update(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number, @Body() dto: TableDto): Promise<{ success: true }> {
    await this.tables.update(req.shop!.shopId, id, dto);
    return { success: true };
  }

  @Patch(':id/active')
  @RequireShopPermission('table_manage')
  async toggle(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true; data: { isActive: boolean } }> {
    return { success: true, data: await this.tables.toggleActive(req.shop!.shopId, id) };
  }

  @Post(':id/regenerate')
  @RequireShopPermission('table_manage')
  async regenerate(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true; data: { qrToken: string } }> {
    return { success: true, data: await this.tables.regenerateToken(req.shop!.shopId, id) };
  }

  @Delete(':id')
  @RequireShopPermission('table_manage')
  async remove(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.tables.remove(req.shop!.shopId, id);
    return { success: true };
  }
}
