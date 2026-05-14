import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { UserRoleEnum } from '@mes/shared';
import type { IJwtPayload } from '@mes/shared';
import { BEARER_PREFIX } from '../../auth/const/AuthConsts';

/**
 * Express middleware that guards Bull Board routes under `/admin/queues`.
 *
 * Why middleware rather than a NestJS guard: Bull Board is mounted as raw Express
 * router middleware by `@bull-board/nestjs`, which runs outside the NestJS request
 * lifecycle. NestJS guards (`APP_GUARD`) never intercept those subroutes.
 * A `MiddlewareConsumer` middleware runs at the Express layer and is the correct
 * place to protect Express-mounted routes.
 *
 * The `JwtService` injected here is the one exported by `AuthModule` (algorithm-pinned
 * to HS256 with `verifyOptions: { algorithms: ['HS256'] }` at module registration).
 * No local secret wiring is needed — the shared service already carries the config.
 *
 * Accepts the JWT via the standard `Authorization: Bearer <token>` header.
 * Rejects with 401 when the token is absent/invalid, 403 when the role is not ADMIN.
 */
@Injectable()
export class BullBoardAuthMiddleware implements NestMiddleware {
    public constructor(private readonly jwtService: JwtService) {}

    public use(req: Request, _res: Response, next: NextFunction): void {
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
            throw new UnauthorizedException('Missing or malformed Authorization header');
        }

        const token = authHeader.slice(BEARER_PREFIX.length);
        let payload: IJwtPayload;

        try {
            payload = this.jwtService.verify<IJwtPayload>(token, { algorithms: ['HS256'] });
        } catch {
            throw new UnauthorizedException('Invalid or expired token');
        }

        if (payload.role !== UserRoleEnum.ADMIN) {
            throw new ForbiddenException('Admin role required');
        }

        next();
    }
}
