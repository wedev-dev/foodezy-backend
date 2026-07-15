import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Admin auth uses an httpOnly cookie; needed before the guards read it.
  app.use(cookieParser());
  // Behind Traefik — required for @Ip() to report the real client address.
  app.set('trust proxy', 1);

  // API routes live under /api; static uploads are served at /uploads (unaffected).
  app.setGlobalPrefix('api');

  const origins = config
    .get<string>('FRONTEND_ORIGIN', '*')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = config.get<number>('PORT', 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
