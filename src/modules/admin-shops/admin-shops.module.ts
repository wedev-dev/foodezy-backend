import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { diskStorage } from 'multer';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PermissionGuard } from '../admin-auth/guards/permission.guard';
import { AuditLog } from '../shops/entities/audit-log.entity';
import { AdminShopsController } from './admin-shops.controller';
import { AdminShopsService } from './admin-shops.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    AdminAuthModule,
    // Same storage rules as the public registration upload.
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uploadDir = config.get<string>('UPLOAD_DIR', './uploads');
        if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

        return {
          storage: diskStorage({
            destination: uploadDir,
            filename: (_req, file, cb) => {
              const ext = extname(file.originalname).toLowerCase();
              cb(null, `${file.fieldname}_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
            },
          }),
          fileFilter: (_req, file, cb) => {
            if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
            cb(new BadRequestException('รองรับเฉพาะรูปภาพ (jpg, png, gif, webp)'), false);
          },
          limits: { fileSize: config.get<number>('MAX_UPLOAD_BYTES', 5_242_880), files: 2 },
        };
      },
    }),
  ],
  controllers: [AdminShopsController],
  providers: [AdminShopsService, PermissionGuard],
})
export class AdminShopsModule {}
