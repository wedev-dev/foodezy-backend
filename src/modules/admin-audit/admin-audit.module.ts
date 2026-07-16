import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminAuditController],
  providers: [AdminAuditService, PermissionGuard],
})
export class AdminAuditModule {}
