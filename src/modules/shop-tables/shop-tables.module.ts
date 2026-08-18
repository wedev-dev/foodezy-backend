import { Module } from '@nestjs/common';
import { ShopAuthModule } from '../shop-auth/shop-auth.module';
import { ShopTablesController } from './shop-tables.controller';
import { ShopTablesService } from './shop-tables.service';

@Module({
  imports: [ShopAuthModule],
  controllers: [ShopTablesController],
  providers: [ShopTablesService],
})
export class ShopTablesModule {}
