import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorator/Public';
import { UnauthorizedError } from '../../common/error/UnauthorizedError';

/**
 * Wraps Passport's `AuthGuard('jwt')`:
 *   - skips routes annotated `@Public()`
 *   - translates any auth failure into the canonical `UnauthorizedError` so the global
 *     filter never has to guess at a code from a passport message
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    public constructor(private readonly reflector: Reflector) {
        super();
    }

    public override canActivate(context: ExecutionContext) {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

        if (isPublic) {
            return true;
        }

        return super.canActivate(context);
    }

    public override handleRequest<TUser>(err: unknown, user: TUser | false, info: unknown): TUser {
        if (user) {
            return user;
        }

        const infoName = this.infoName(info);

        if (infoName === 'TokenExpiredError') {
            throw new UnauthorizedError('AUTH_TOKEN_EXPIRED', err);
        }

        if (infoName === 'JsonWebTokenError' || infoName === 'NotBeforeError') {
            throw new UnauthorizedError('AUTH_INVALID_TOKEN', err);
        }

        if (infoName === 'Error' || infoName === undefined) {
            // Distinguish "no Authorization header at all" from "header present but malformed".
            const infoMessage = this.infoMessage(info);

            if (infoMessage === 'No auth token') {
                throw new UnauthorizedError('AUTH_MISSING_TOKEN', err);
            }

            throw new UnauthorizedError('AUTH_INVALID_TOKEN', err);
        }

        throw new UnauthorizedError('AUTH_INVALID_TOKEN', err);
    }

    private infoName(info: unknown): string | undefined {
        if (info && typeof info === 'object' && 'name' in info && typeof (info as { name?: unknown }).name === 'string') {
            // `as` is a genuine narrowing: we just verified the shape at runtime above.
            return (info as { name: string }).name;
        }

        return undefined;
    }

    private infoMessage(info: unknown): string | undefined {
        if (info && typeof info === 'object' && 'message' in info && typeof (info as { message?: unknown }).message === 'string') {
            // `as` is a genuine narrowing: we just verified the shape at runtime above.
            return (info as { message: string }).message;
        }

        return undefined;
    }
}
