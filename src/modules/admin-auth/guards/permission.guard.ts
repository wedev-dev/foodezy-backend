import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithAdmin } from './admin-auth.guard';

export const PERMISSION_KEY = 'requiredPermission';

/** Use together with AdminAuthGuard: @UseGuards(AdminAuthGuard, PermissionGuard) */
export const RequirePermission = (module: string) => SetMetadata(PERMISSION_KEY, module);

/**
 * Mirrors checkMenuAccess() in mainmenu.php: 'all' is superadmin, otherwise
 * menu_access holds JSON such as {"system":true}. Rows that aren't valid JSON
 * grant nothing — same as the legacy json_decode(...) ?: [] behaviour.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<RequestWithAdmin>();
    const access = req.admin?.menuAccess ?? '';

    if (access === 'all') return true;

    try {
      const perms: unknown = JSON.parse(access);
      if (perms && typeof perms === 'object' && (perms as Record<string, unknown>)[required]) {
        return true;
      }
    } catch {
      // not JSON -> no permissions
    }

    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงส่วนนี้');
  }
}
