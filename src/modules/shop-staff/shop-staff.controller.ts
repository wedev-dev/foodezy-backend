import {
  Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import {
  RequireShopPermission, RequestWithShop, ShopAuthGuard,
} from '../shop-auth/guards/shop-auth.guard';
import { PermissionRow, ShopStaffService, StaffRow } from './shop-staff.service';
import { StaffDto } from './dto/staff.dto';

/** เฉพาะเจ้าของร้าน (superadmin) เท่านั้น */
function assertSuperadmin(req: RequestWithShop): void {
  if (!(req.shop!.isSuperadmin || req.shop!.role === 'owner')) {
    throw new ForbiddenException('เฉพาะเจ้าของร้านเท่านั้นที่จัดการพนักงานได้');
  }
}

@Controller('shop/staff')
@UseGuards(ShopAuthGuard)
export class ShopStaffController {
  constructor(private readonly staff: ShopStaffService) {}

  @Get()
  @RequireShopPermission('staff_manage')
  async list(@Req() req: RequestWithShop): Promise<{ success: true; data: { staff: StaffRow[]; permissions: PermissionRow[] } }> {
    assertSuperadmin(req);
    const [staff, permissions] = await Promise.all([
      this.staff.list(req.shop!.shopId),
      this.staff.permissions(),
    ]);
    return { success: true, data: { staff, permissions } };
  }

  @Post()
  @RequireShopPermission('staff_manage')
  async create(@Req() req: RequestWithShop, @Body() dto: StaffDto): Promise<{ success: true; data: { id: number } }> {
    assertSuperadmin(req);
    return { success: true, data: await this.staff.create(req.shop!.shopId, dto) };
  }

  @Put(':id')
  @RequireShopPermission('staff_manage')
  async update(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number, @Body() dto: StaffDto): Promise<{ success: true }> {
    assertSuperadmin(req);
    await this.staff.update(req.shop!.shopId, id, dto);
    return { success: true };
  }

  @Patch(':id/active')
  @RequireShopPermission('staff_manage')
  async toggle(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true; data: { isActive: boolean } }> {
    assertSuperadmin(req);
    return { success: true, data: await this.staff.toggleActive(req.shop!.shopId, id) };
  }

  @Delete(':id')
  @RequireShopPermission('staff_manage')
  async remove(@Req() req: RequestWithShop, @Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    assertSuperadmin(req);
    await this.staff.remove(req.shop!.shopId, id);
    return { success: true };
  }
}
