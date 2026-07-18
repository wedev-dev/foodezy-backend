import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { ShopAuthService, ShopIdentity } from './shop-auth.service';
import { OwnerLoginDto } from './dto/owner-login.dto';
import { StaffLoginDto } from './dto/staff-login.dto';
import { SHOP_COOKIE_NAME, ShopAuthGuard, RequestWithShop } from './guards/shop-auth.guard';

@Controller('shop/auth')
export class ShopAuthController {
  constructor(
    private readonly shopAuth: ShopAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async loginOwner(
    @Body() dto: OwnerLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: ShopIdentity }> {
    const result = await this.shopAuth.loginOwner(dto.phone, dto.password, dto.remember ?? false);
    res.cookie(SHOP_COOKIE_NAME, result.token, this.cookieOptions(result.maxAgeMs));
    return { success: true, data: result.identity };
  }

  @Post('login/staff')
  @HttpCode(200)
  async loginStaff(
    @Body() dto: StaffLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: ShopIdentity }> {
    const result = await this.shopAuth.loginStaff(
      dto.shopCode,
      dto.username,
      dto.password,
      dto.remember ?? false,
    );
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

  /** Cookie set on the API host but sent by the shop host — scoped to the shared parent domain. */
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
