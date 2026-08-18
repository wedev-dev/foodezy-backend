import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { diskStorage } from 'multer';
import { ShopAuthModule } from '../shop-auth/shop-auth.module';
import { ShopMenusController } from './shop-menus.controller';
import { ShopMenusService } from './shop-menus.service';
import { ShopCategoriesController } from './shop-categories.controller';
import { ShopCategoriesService } from './shop-categories.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

@Module({
  imports: [
    ShopAuthModule,
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
              cb(null, `menu_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
            },
          }),
          fileFilter: (_req, file, cb) => {
            if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
            cb(new BadRequestException('รองรับเฉพาะรูปภาพ (jpg, png, gif, webp)'), false);
          },
          limits: { fileSize: config.get<number>('MAX_UPLOAD_BYTES', 5_242_880), files: 1 },
        };
      },
    }),
  ],
  controllers: [ShopMenusController, ShopCategoriesController],
  providers: [ShopMenusService, ShopCategoriesService],
})
export class ShopMenusModule {}
