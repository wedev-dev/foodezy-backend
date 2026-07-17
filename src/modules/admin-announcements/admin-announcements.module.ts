import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminAnnouncementsController } from './admin-announcements.controller';
import { AdminAnnouncementsService } from './admin-announcements.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminAnnouncementsController],
  providers: [AdminAnnouncementsService, PermissionGuard],
})
export class AdminAnnouncementsModule {}
