import { Module } from '@nestjs/common';
import { ShopAuthModule } from '../shop-auth/shop-auth.module';
import { ShopPosController } from './shop-pos.controller';
import { ShopPosService } from './shop-pos.service';

@Module({
  imports: [ShopAuthModule],
  controllers: [ShopPosController],
  providers: [ShopPosService],
})
export class ShopPosModule {}
