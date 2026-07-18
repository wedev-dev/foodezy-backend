import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminFoodCategoriesController } from './admin-food-categories.controller';
import { AdminFoodCategoriesService } from './admin-food-categories.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AdminAuthModule],
  controllers: [AdminFoodCategoriesController],
  providers: [AdminFoodCategoriesService, PermissionGuard],
})
export class AdminFoodCategoriesModule {}
