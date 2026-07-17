import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminBillingController],
  providers: [AdminBillingService, PermissionGuard],
})
export class AdminBillingModule {}
