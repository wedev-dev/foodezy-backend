import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ShopAuthService, ShopIdentity, ShopTokenPayload } from '../shop-auth.service';

export const SHOP_COOKIE_NAME = 'foodezy_shop';

export const REQUIRE_SHOP_PERMISSION = 'require_shop_permission';
export const RequireShopPermission = (slug: string): MethodDecorator =>
  SetMetadata(REQUIRE_SHOP_PERMISSION, slug);

export interface RequestWithShop extends Request {
  shop?: ShopIdentity;
}

@Injectable()
export class ShopAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly shopAuth: ShopAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithShop>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SHOP_COOKIE_NAME];

    const denied = new UnauthorizedException('กรุณาเข้าสู่ระบบ');
    if (!token) throw denied;

    let payload: ShopTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<ShopTokenPayload>(token);
    } catch {
      throw denied;
    }

    const identity = await this.shopAuth.resolveIdentity(payload);
    if (!identity) throw denied;
    req.shop = identity;

    const required = this.reflector.get<string | undefined>(
      REQUIRE_SHOP_PERMISSION,
      context.getHandler(),
    );
    if (required && !identity.isSuperadmin && !identity.permissions.includes(required)) {
      throw new UnauthorizedException('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
    }

    return true;
  }
}
