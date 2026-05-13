import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IAuthenticatedUser, UserRoleEnum } from '@mes/shared';
import { ROLES_KEY } from '../decorator/Roles';
import { ForbiddenError } from '../../common/error/ForbiddenError';

/**
 * Reads `@Roles(...)` metadata on the handler (with class fallback) and rejects requests
 * whose authenticated user does not hold one of the listed roles. If no metadata is set,
 * any authenticated user passes — gating to specific roles is opt-in per route.
 *
 * `@Public()` routes never reach this guard because `JwtAuthGuard` short-circuits first
 * (Nest runs APP_GUARDs in declaration order — see app.module.ts).
 */
@Injectable()
export class RolesGuard implements CanActivate {
    public constructor(private readonly reflector: Reflector) {}

    public canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<UserRoleEnum[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);

        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<{ user?: IAuthenticatedUser }>();
        const user = request.user;

        if (!user || !requiredRoles.includes(user.role)) {
            throw new ForbiddenError();
        }

        return true;
    }
}
