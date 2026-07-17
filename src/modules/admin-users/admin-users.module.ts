import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SuperAdminGuard } from '../admin-auth/guards/superadmin.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, SuperAdminGuard],
})
export class AdminUsersModule {}
