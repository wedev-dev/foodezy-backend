import {
  Body,
  Controller,
  Headers,
  Ip,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { RegisterShopDto } from './dto/register-shop.dto';
import { ShopsService, UploadedShopImages } from './shops.service';

@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Post('register')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'shopFront', maxCount: 1 },
      { name: 'shopInside', maxCount: 1 },
    ]),
  )
  async register(
    @Body() dto: RegisterShopDto,
    @UploadedFiles() files: UploadedShopImages,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ success: true; data: { shopId: number; shopCode: string; trialEndAt: Date } }> {
    const result = await this.shopsService.register(dto, files ?? {}, {
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    });
    return { success: true, data: result };
  }
}
