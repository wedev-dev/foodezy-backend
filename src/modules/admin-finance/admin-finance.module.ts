import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminFinanceService } from './admin-finance.service';
import { AdminPlatformStatsController } from './admin-platform-stats.controller';
import { AdminRevenueController } from './admin-revenue.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminRevenueController, AdminPlatformStatsController],
  providers: [AdminFinanceService, PermissionGuard],
})
export class AdminFinanceModule {}
