import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IAuthenticatedUser } from '@mes/shared';
import { UnauthorizedError } from '../../common/error/UnauthorizedError';

/**
 * Pulls the authenticated user attached to the request by `JwtAuthGuard`. Replaces
 * the bare `@Req() req.user` pattern so handlers state the dependency in their signature.
 *
 * Reaching this code with no `request.user` means the route is missing `@Public()` and
 * the global `JwtAuthGuard` failed to short-circuit — translate it into the canonical
 * AUTH_INVALID_TOKEN response rather than a 500.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): IAuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: IAuthenticatedUser }>();

    if (!request.user) {
        throw new UnauthorizedError('AUTH_INVALID_TOKEN');
    }

    return request.user;
});
