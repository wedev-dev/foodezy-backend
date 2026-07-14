import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { diskStorage } from 'multer';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { AuditLog } from './entities/audit-log.entity';
import { Shop } from './entities/shop.entity';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

@Module({
  imports: [
    TypeOrmModule.forFeature([Shop, AuditLog]),
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
              const name = `${file.fieldname}_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
              cb(null, name);
            },
          }),
          // MIME check (the old code only checked file extension).
          fileFilter: (_req, file, cb) => {
            if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
            cb(new BadRequestException('รองรับเฉพาะรูปภาพ (jpg, png, gif, webp)'), false);
          },
          limits: {
            fileSize: config.get<number>('MAX_UPLOAD_BYTES', 5_242_880),
            files: 2,
          },
        };
      },
    }),
  ],
  controllers: [ShopsController],
  providers: [ShopsService],
})
export class ShopsModule {}
