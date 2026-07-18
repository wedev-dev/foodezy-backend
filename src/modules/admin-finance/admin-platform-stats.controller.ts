import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import { AdminFinanceService, PlatformStats } from './admin-finance.service';

/** Separate controller: platform_stats.php gated on 'system', not 'billing'. */
@Controller('admin/platform-stats')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('system')
export class AdminPlatformStatsController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get()
  async stats(): Promise<{ success: true; data: PlatformStats }> {
    return { success: true, data: await this.finance.platformStats() };
  }
}
