import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminWebhookController } from './admin-webhook.controller';
import { AdminWebhookService } from './admin-webhook.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminWebhookController],
  providers: [AdminWebhookService, PermissionGuard],
})
export class AdminWebhookModule {}
