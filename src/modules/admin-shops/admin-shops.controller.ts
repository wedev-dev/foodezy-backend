import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  AdminShopsService,
  ActorMeta,
  PendingShopPage,
  ShopDetail,
  ShopListPage,
} from './admin-shops.service';
import { PendingQueryDto } from './dto/pending-query.dto';
import { ShopListQueryDto } from './dto/shop-list-query.dto';
import { UpdateShopStatusDto } from './dto/update-shop-status.dto';

@Controller('admin/shops')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('shops')
export class AdminShopsController {
  constructor(private readonly shops: AdminShopsService) {}

  @Get('pending')
  async listPending(
    @Query() query: PendingQueryDto,
  ): Promise<{ success: true; data: PendingShopPage }> {
    return { success: true, data: await this.shops.listPending(query.page ?? 1) };
  }

  @Get()
  async list(@Query() query: ShopListQueryDto): Promise<{ success: true; data: ShopListPage }> {
    return { success: true, data: await this.shops.list(query.status, query.search, query.page ?? 1) };
  }

  // Declared after 'pending' so that literal route isn't captured by :id.
  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: true; data: ShopDetail }> {
    return { success: true, data: await this.shops.detail(id) };
  }

  @Patch(':id/status')
  @HttpCode(200)
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShopStatusDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.shops.updateStatus(id, dto.status, this.actor(req, ip, userAgent));
    return { success: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async softDelete(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.shops.softDelete(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
