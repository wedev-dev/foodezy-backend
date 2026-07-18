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
import { ActorMeta, AdminCallStaffService, CallStaffRow } from './admin-call-staff.service';
import { SaveCallStaffDto } from './dto/save-call-staff.dto';
import { ToggleActiveDto } from './dto/toggle-active.dto';

@Controller('admin/call-staff-templates')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('menus')
export class AdminCallStaffController {
  constructor(private readonly callStaff: AdminCallStaffService) {}

  @Get()
  async list(): Promise<{ success: true; data: CallStaffRow[] }> {
    return { success: true, data: await this.callStaff.list() };
  }

  @Post()
  async create(
    @Body() dto: SaveCallStaffDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    return { success: true, data: await this.callStaff.create(dto, this.actor(req, ip, userAgent)) };
  }

  @Put(':id')
  @HttpCode(200)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveCallStaffDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.callStaff.update(id, dto, this.actor(req, ip, userAgent));
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
    await this.callStaff.toggle(id, dto.isActive, this.actor(req, ip, userAgent));
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
    await this.callStaff.remove(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
