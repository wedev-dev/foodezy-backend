import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDatabaseConfig } from './config/database.config';
import { AdminAccountModule } from './modules/admin-account/admin-account.module';
import { AdminAnnouncementsModule } from './modules/admin-announcements/admin-announcements.module';
import { AdminAuditModule } from './modules/admin-audit/admin-audit.module';
import { AdminBillingModule } from './modules/admin-billing/admin-billing.module';
import { AdminFinanceModule } from './modules/admin-finance/admin-finance.module';
import { AdminPackagesModule } from './modules/admin-packages/admin-packages.module';
import { AdminShopTypesModule } from './modules/admin-shop-types/admin-shop-types.module';
import { AdminFoodCategoriesModule } from './modules/admin-food-categories/admin-food-categories.module';
import { AdminCallStaffModule } from './modules/admin-call-staff/admin-call-staff.module';
import { AdminOptionTemplatesModule } from './modules/admin-option-templates/admin-option-templates.module';
import { AdminMenuTemplatesModule } from './modules/admin-menu-templates/admin-menu-templates.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module';
import { AdminShopsModule } from './modules/admin-shops/admin-shops.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AdminWebhookModule } from './modules/admin-webhook/admin-webhook.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ShopsModule } from './modules/shops/shops.module';
import { ShopAuthModule } from './modules/shop-auth/shop-auth.module';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildDatabaseConfig,
    }),
    // Serve uploaded shop images: <UPLOAD_DIR> is exposed under <UPLOAD_URL_PREFIX>.
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          rootPath: config.get<string>('UPLOAD_DIR', './uploads'),
          serveRoot: config.get<string>('UPLOAD_URL_PREFIX', '/uploads'),
          serveStaticOptions: { index: false, fallthrough: true },
        },
      ],
    }),
    ShopsModule,
    ShopAuthModule,
    AdminAuthModule,
    AdminDashboardModule,
    AdminAccountModule,
    AdminAuditModule,
    AdminShopsModule,
    AdminAnnouncementsModule,
    AdminUsersModule,
    AdminWebhookModule,
    MaintenanceModule,
    AdminBillingModule,
    AdminFinanceModule,
    // --- Phase 4A: central library ---
    AdminPackagesModule,
    AdminShopTypesModule,
    AdminFoodCategoriesModule,
    AdminCallStaffModule,
    // --- Phase 4B: menu & option templates ---
    AdminOptionTemplatesModule,
    AdminMenuTemplatesModule,
  ],
})
export class AppModule {}