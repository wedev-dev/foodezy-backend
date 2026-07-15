import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AdminAuthService, AdminPayload, AdminProfile } from '../admin-auth.service';

export const ADMIN_COOKIE_NAME = 'foodezy_admin';

export interface RequestWithAdmin extends Request {
  admin?: AdminProfile;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAdmin>();
    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_COOKIE_NAME];

    const denied = new UnauthorizedException('กรุณาเข้าสู่ระบบ');
    if (!token) throw denied;

    let payload: AdminPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminPayload>(token);
    } catch {
      throw denied;
    }

    // Hitting the DB each request means a ban takes effect immediately
    // instead of waiting for the token to expire.
    const admin = await this.adminAuth.findActiveById(payload.sub);
    if (!admin) throw denied;

    req.admin = admin;
    return true;
  }
}
