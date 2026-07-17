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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import {
  ActorMeta,
  AdminAnnouncementsService,
  AnnouncementRow,
} from './admin-announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Controller('admin/announcements')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('system')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AdminAnnouncementsService) {}

  @Get()
  async list(): Promise<{ success: true; data: AnnouncementRow[] }> {
    return { success: true, data: await this.announcements.list() };
  }

  @Post()
  async create(
    @Body() dto: CreateAnnouncementDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { id: number; shopsNotified: number } }> {
    const data = await this.announcements.create(dto, this.actor(req, ip, userAgent));
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.announcements.remove(id, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
