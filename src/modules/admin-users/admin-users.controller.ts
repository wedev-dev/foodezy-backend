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
import { SuperAdminGuard } from '../admin-auth/guards/superadmin.guard';
import { ActorMeta, AdminUserRow, AdminUsersService } from './admin-users.service';
import { SaveAdminUserDto } from './dto/save-admin-user.dto';

@Controller('admin/users')
@UseGuards(AdminAuthGuard, SuperAdminGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  async list(@Req() req: RequestWithAdmin): Promise<{
    success: true;
    data: { rows: AdminUserRow[]; currentAdminId: number };
  }> {
    return {
      success: true,
      data: { rows: await this.users.list(), currentAdminId: req.admin!.adminId },
    };
  }

  @Post()
  async create(
    @Body() dto: SaveAdminUserDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { id: number } }> {
    const id = await this.users.create(dto, this.actor(req, ip, userAgent));
    return { success: true, data: { id } };
  }

  @Put(':id')
  @HttpCode(200)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveAdminUserDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.users.update(id, dto, this.actor(req, ip, userAgent));
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
    await this.users.remove(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
