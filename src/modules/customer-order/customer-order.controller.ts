import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ShopPosService, OrderDetail, PosCategory, PosMenu } from '../shop-pos/shop-pos.service';
import { CreateOrderDto } from '../shop-pos/dto/create-order.dto';

// หน้าลูกค้า (สแกน QR) — public ไม่ต้องล็อกอิน, ใช้ qr_token เป็นตัวระบุโต๊ะ
@Controller('order')
export class CustomerOrderController {
  constructor(private readonly pos: ShopPosService) {}

  @Get(':token/menu')
  async menu(@Param('token') token: string): Promise<{
    success: true;
    data: {
      shopName: string; tableNumber: string; isOpen: boolean; canOrder: boolean;
      categories: PosCategory[]; menus: PosMenu[];
    };
  }> {
    const t = await this.pos.resolveToken(token);
    const catalog = await this.pos.catalog(t.shopId);
    return {
      success: true,
      data: {
        shopName: t.shopName,
        tableNumber: t.tableNumber,
        isOpen: t.isOpen,
        canOrder: t.isOpen && (t.orderMode === 'qr_only' || t.orderMode === 'both'),
        categories: catalog.categories,
        menus: catalog.menus,
      },
    };
  }

  @Get(':token/orders')
  async orders(@Param('token') token: string): Promise<{ success: true; data: { orders: OrderDetail[]; total: number } }> {
    const t = await this.pos.resolveToken(token);
    const bill = await this.pos.tableBill(t.shopId, t.tableId);
    return { success: true, data: { orders: bill.orders, total: bill.total } };
  }

  @Post(':token/orders')
  async create(
    @Param('token') token: string,
    @Body() body: Omit<CreateOrderDto, 'tableId'>,
  ): Promise<{ success: true; data: OrderDetail }> {
    const t = await this.pos.resolveToken(token);
    if (!t.isOpen) throw new BadRequestException('ร้านปิดรับออเดอร์อยู่ในขณะนี้');
    if (t.orderMode === 'staff_only') throw new BadRequestException('ร้านนี้ให้พนักงานรับออเดอร์เท่านั้น');
    const dto: CreateOrderDto = { tableId: t.tableId, items: body.items, note: body.note };
    return { success: true, data: await this.pos.createOrder(t.shopId, dto, 'qr') };
  }

  @Post(':token/call')
  async call(
    @Param('token') token: string,
    @Body() body: { callType?: string; message?: string },
  ): Promise<{ success: true; data: { ok: true } }> {
    const t = await this.pos.resolveToken(token);
    if (!t.isOpen) throw new BadRequestException('ร้านปิดอยู่ในขณะนี้');
    return { success: true, data: await this.pos.callStaff(t.shopId, t.tableId, body.callType ?? 'ask', body.message ?? null) };
  }
}
