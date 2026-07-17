import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestWithAdmin } from './admin-auth.guard';

/**
 * menu_access === 'all' only. Use with AdminAuthGuard for pages the legacy
 * code gated behind `$is_superadmin`.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithAdmin>();
    if (req.admin?.menuAccess === 'all') return true;
    throw new ForbiddenException('เฉพาะ Superadmin เท่านั้น');
  }
}
