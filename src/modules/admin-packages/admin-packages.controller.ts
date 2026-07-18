import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, RequestWithAdmin } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import { ActorMeta, AdminPackagesService, PackageRow } from './admin-packages.service';
import { UpdatePackageDto } from './dto/update-package.dto';

// Packages live under the billing menu group in the legacy sidebar, so they
// are gated by the 'billing' permission — not 'menus'.
@Controller('admin/packages')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('billing')
export class AdminPackagesController {
  constructor(private readonly packages: AdminPackagesService) {}

  @Get()
  async list(): Promise<{ success: true; data: PackageRow[] }> {
    return { success: true, data: await this.packages.list() };
  }

  @Put(':id')
  @HttpCode(200)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePackageDto,
    @Req() req: RequestWithAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true }> {
    await this.packages.update(id, dto, this.actor(req, ip, userAgent));
    return { success: true };
  }

  private actor(req: RequestWithAdmin, ip: string, userAgent: string | undefined): ActorMeta {
    return { adminId: req.admin!.adminId, ip: ip ?? null, userAgent: userAgent ?? null };
  }
}
