import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import {
  PermissionGuard,
  RequirePermission,
} from '../admin-auth/guards/permission.guard';
import { AdminAuditService, AuditLogPage, AuditLogRow } from './admin-audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Controller('admin/audit-logs')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('system')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  async list(@Query() query: AuditLogQueryDto): Promise<{ success: true; data: AuditLogPage }> {
    return { success: true, data: await this.audit.list(query) };
  }

  @Get('export')
  async export(
    @Query() query: AuditLogQueryDto,
  ): Promise<{ success: true; data: AuditLogRow[] }> {
    return { success: true, data: await this.audit.export(query) };
  }
}
