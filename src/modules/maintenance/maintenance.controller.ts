import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { PermissionGuard, RequirePermission } from '../admin-auth/guards/permission.guard';
import { AutoSuspendService } from './auto-suspend.service';

@Controller('admin/maintenance')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('shops')
export class MaintenanceController {
  constructor(private readonly autoSuspend: AutoSuspendService) {}

  /** Lets an admin run the sweep now instead of waiting for the next hour. */
  @Post('auto-suspend')
  @HttpCode(200)
  async runAutoSuspend(): Promise<{ success: true; data: { suspended: number } }> {
    const suspended = await this.autoSuspend.run('manual');
    return { success: true, data: { suspended } };
  }
}
