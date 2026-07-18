import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminOptionTemplatesController } from './admin-option-templates.controller';
import { AdminOptionTemplatesService } from './admin-option-templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminOptionTemplatesController],
  providers: [AdminOptionTemplatesService, PermissionGuard],
})
export class AdminOptionTemplatesModule {}
