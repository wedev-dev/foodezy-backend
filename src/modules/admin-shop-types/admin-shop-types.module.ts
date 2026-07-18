import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminShopTypesController } from './admin-shop-types.controller';
import { AdminShopTypesService } from './admin-shop-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminShopTypesController],
  providers: [AdminShopTypesService, PermissionGuard],
})
export class AdminShopTypesModule {}
