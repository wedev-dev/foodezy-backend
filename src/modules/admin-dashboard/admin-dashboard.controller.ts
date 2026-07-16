import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminDashboardService, DashboardData } from './admin-dashboard.service';

@Controller('admin/dashboard')
@UseGuards(AdminAuthGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  async get(): Promise<{ success: true; data: DashboardData }> {
    return { success: true, data: await this.dashboard.getDashboard() };
  }
}
