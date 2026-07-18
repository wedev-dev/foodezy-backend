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
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  ActorMeta,
  AdminOptionTemplatesService,
  OptionGroupRow,
} from './admin-option-templates.service';
import { SaveOptionGroupDto } from './dto/save-option-group.dto';
import { SaveOptionItemDto } from './dto/save-option-item.dto';

@Controller('admin/option-templates')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('menus')
export class AdminOptionTemplatesController {
  constructor(private readonly options: AdminOptionTemplatesService) {}

  @Get()
  async list(): Promise<{ success: true; data: OptionGroupRow[] }> {
    return { success: true, data: await this.options.listGroups() };
  }

  @Post('groups')
  async createGroup(
    @Body() dto: SaveOptionGroupDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.options.createGroup(dto, this.actor(req, ip, ua)) };
  }

  @Put('groups/:id')
  @HttpCode(200)
  async updateGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveOptionGroupDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true }> {
    await this.options.updateGroup(id, dto, this.actor(req, ip, ua));
    return { success: true };
  }

  @Delete('groups/:id')
  @HttpCode(200)
  async deleteGroup(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true }> {
    await this.options.deleteGroup(id, this.actor(req, ip, ua));
    return { success: true };
  }

  @Post('groups/:id/items')
  async addItem(
    @Param('id', ParseIntPipe) groupId: number,
    @Body() dto: SaveOptionItemDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.options.addItem(groupId, dto, this.actor(req, ip, ua)) };
  }

  @Put('items/:id')
  @HttpCode(200)
  async updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveOptionItemDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true }> {
    await this.options.updateItem(id, dto, this.actor(req, ip, ua));
    return { success: true };
  }

  @Delete('items/:id')
  @HttpCode(200)
  async deleteItem(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<{ success: true }> {
    await this.options.deleteItem(id, this.actor(req, ip, ua));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, ua: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: ua ?? null };
  }
}
