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
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import { ActorMeta, AdminShopTypesService, ShopTypeRow } from './admin-shop-types.service';
import { SaveShopTypeDto } from './dto/save-shop-type.dto';
import { ToggleActiveDto } from './dto/toggle-active.dto';

@Controller('admin/shop-types')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('menus')
export class AdminShopTypesController {
  constructor(private readonly shopTypes: AdminShopTypesService) {}

  @Get()
  async list(): Promise<{ success: true; data: ShopTypeRow[] }> {
    return { success: true, data: await this.shopTypes.list() };
  }

  @Post()
  async create(
    @Body() dto: SaveShopTypeDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.shopTypes.create(dto, this.actor(req, ip, userAgent)) };
  }

  @Put(':id')
  @HttpCode(200)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveShopTypeDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.shopTypes.update(id, dto, this.actor(req, ip, userAgent));
    return { success: true };
  }

  @Patch(':id/toggle')
  @HttpCode(200)
  async toggle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleActiveDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.shopTypes.toggle(id, dto.isActive, this.actor(req, ip, userAgent));
    return { success: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.shopTypes.remove(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
