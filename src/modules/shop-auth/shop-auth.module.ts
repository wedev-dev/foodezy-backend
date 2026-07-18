import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ShopAuthController } from './shop-auth.controller';
import { ShopAuthService } from './shop-auth.service';
import { ShopAuthGuard } from './guards/shop-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [ShopAuthController],
  providers: [ShopAuthService, ShopAuthGuard],
  exports: [ShopAuthService, ShopAuthGuard, JwtModule],
})
export class ShopAuthModule {}
