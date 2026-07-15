import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { AdminAuthService, AdminProfile } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import {
  ADMIN_COOKIE_NAME,
  AdminAuthGuard,
  RequestWithAdmin,
} from './guards/admin-auth.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: AdminLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: AdminProfile }> {
    const result = await this.adminAuth.login(
      dto.username,
      dto.password,
      dto.remember ?? false,
      { ip: ip ?? null, userAgent: userAgent ?? null },
    );

    res.cookie(ADMIN_COOKIE_NAME, result.token, this.cookieOptions(result.maxAgeMs));
    return { success: true, data: result.admin };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(ADMIN_COOKIE_NAME, this.cookieOptions(null));
    return { success: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@Req() req: RequestWithAdmin): { success: true; data: AdminProfile } {
    return { success: true, data: req.admin! };
  }

  /**
   * The cookie is set on the API host (api.foodezy.wedev.site) but must also be
   * sent by the site host (foodezy.wedev.site), so it is scoped to the shared
   * parent domain via COOKIE_DOMAIN.
   */
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
