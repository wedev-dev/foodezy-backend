import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { ShopAuthService, ShopIdentity, ShopSubscription } from './shop-auth.service';
import { LoginDto } from './dto/login.dto';
import { SHOP_COOKIE_NAME, ShopAuthGuard, RequestWithShop } from './guards/shop-auth.guard';

@Controller('shop/auth')
export class ShopAuthController {
  constructor(
    private readonly shopAuth: ShopAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: ShopIdentity }> {
    const result = await this.shopAuth.login(dto.phone, dto.password, dto.remember ?? false);
    res.cookie(SHOP_COOKIE_NAME, result.token, this.cookieOptions(result.maxAgeMs));
    return { success: true, data: result.identity };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(SHOP_COOKIE_NAME, this.cookieOptions(null));
    return { success: true };
  }

  @Get('me')
  @UseGuards(ShopAuthGuard)
  me(@Req() req: RequestWithShop): { success: true; data: ShopIdentity } {
    return { success: true, data: req.shop! };
  }

  @Get('subscription')
  @UseGuards(ShopAuthGuard)
  async subscription(@Req() req: RequestWithShop): Promise<{ success: true; data: ShopSubscription }> {
    return { success: true, data: await this.shopAuth.subscription(req.shop!.shopId) };
  }

  @Post('heartbeat')
  @HttpCode(200)
  @UseGuards(ShopAuthGuard)
  async heartbeat(@Req() req: RequestWithShop): Promise<{ success: true }> {
    await this.shopAuth.touchLastSeen(req.shop!.shopId, req.shop!.staffId);
    return { success: true };
  }

  private cookieOptions(maxAgeMs: number | null): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN');
    const secure = this.config.get<string>('COOKIE_SECURE', 'true') === 'true';
    return {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      ...(domain ? { domain } : {}),
      ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
    };
  }
}
