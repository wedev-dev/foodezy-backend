import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  RequireShopPermission,
  RequestWithShop,
  ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import {
  Checkout,
  OrderDetail,
  PayResult,
  PosCategory,
  PosMenu,
  PosTable,
  ShopPosService,
  TableBill,
} from './shop-pos.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateItemStatusDto, UpdateOrderStatusDto } from './dto/update-status.dto';
import { PayDto } from './dto/pay.dto';

@Controller('shop/pos')
@UseGuards(ShopAuthGuard)
export class ShopPosController {
  constructor(private readonly pos: ShopPosService) {}

  @Get('menu')
  @RequireShopPermission('pos_access')
  async menu(
    @Req() req: RequestWithShop,
  ): Promise<{ success: true; data: { categories: PosCategory[]; menus: PosMenu[] } }> {
    return { success: true, data: await this.pos.catalog(req.shop!.shopId) };
  }

  @Get('tables')
  @RequireShopPermission('pos_access')
  async tables(@Req() req: RequestWithShop): Promise<{ success: true; data: PosTable[] }> {
    return { success: true, data: await this.pos.tables(req.shop!.shopId) };
  }

  @Get('tables/:id/bill')
  @RequireShopPermission('pos_access')
  async tableBill(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true; data: TableBill }> {
    return { success: true, data: await this.pos.tableBill(req.shop!.shopId, id) };
  }

  @Post('tables/:id/close')
  @RequireShopPermission('pos_access')
  async closeTable(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true; data: { closed: boolean } }> {
    return { success: true, data: await this.pos.closeTable(req.shop!.shopId, id) };
  }

  @Get('tables/:id/checkout')
  @RequireShopPermission('pos_access')
  async checkout(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true; data: Checkout }> {
    return { success: true, data: await this.pos.checkout(req.shop!.shopId, id) };
  }

  @Post('tables/:id/pay')
  @RequireShopPermission('pos_access')
  async pay(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayDto,
  ): Promise<{ success: true; data: PayResult }> {
    return { success: true, data: await this.pos.pay(req.shop!.shopId, id, dto.method) };
  }

  @Post('orders')
  @RequireShopPermission('pos_access')
  async createOrder(
    @Req() req: RequestWithShop,
    @Body() dto: CreateOrderDto,
  ): Promise<{ success: true; data: OrderDetail }> {
    return { success: true, data: await this.pos.createOrder(req.shop!.shopId, dto) };
  }

  @Get('orders')
  @RequireShopPermission('pos_access')
  async orders(@Req() req: RequestWithShop): Promise<{ success: true; data: OrderDetail[] }> {
    return { success: true, data: await this.pos.activeOrders(req.shop!.shopId) };
  }

  @Get('orders/:id')
  @RequireShopPermission('pos_access')
  async orderDetail(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true; data: OrderDetail | null }> {
    return { success: true, data: await this.pos.orderDetail(req.shop!.shopId, id) };
  }

  @Patch('orders/:id/status')
  @RequireShopPermission('pos_access')
  async updateOrderStatus(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<{ success: true }> {
    await this.pos.updateOrderStatus(req.shop!.shopId, id, dto.status);
    return { success: true };
  }

  @Patch('order-items/:id/status')
  @RequireShopPermission('pos_access')
  async updateItemStatus(
    @Req() req: RequestWithShop,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemStatusDto,
  ): Promise<{ success: true }> {
    await this.pos.updateItemStatus(req.shop!.shopId, id, dto.status);
    return { success: true };
  }
}
