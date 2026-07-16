import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { Admin } from '../admin-auth/entities/admin.entity';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminAccountController } from './admin-account.controller';
import { AdminAccountService } from './admin-account.service';

@Module({
  imports: [TypeOrmModule.forFeature([Admin, AuditLog]), AdminAuthModule],
  controllers: [AdminAccountController],
  providers: [AdminAccountService],
})
export class AdminAccountModule {}
