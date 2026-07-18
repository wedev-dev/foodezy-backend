import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminCallStaffController } from './admin-call-staff.controller';
import { AdminCallStaffService } from './admin-call-staff.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminCallStaffController],
  providers: [AdminCallStaffService, PermissionGuard],
})
export class AdminCallStaffModule {}
