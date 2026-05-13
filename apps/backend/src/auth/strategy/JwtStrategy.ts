import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRoleEnum } from '@mes/shared';
import type { IAuthenticatedUser, IJwtPayload } from '@mes/shared';
import { DEFAULT_JWT_EXPIRES_IN } from '../const/AuthConsts';
import { assertJwtConfig } from '../util/assertJwtConfig';
import { UnauthorizedError } from '../../common/error/UnauthorizedError';

/**
 * Passport JWT strategy.
 *
 * Algorithm pinning to HS256 is non-negotiable per ADR 0003 — without it, attackers
 * can forge tokens via the `alg: none` and `alg: RS256→public-key` confusion families.
 *
 * The strategy returns `IAuthenticatedUser` (NOT the raw payload); Nest's `AuthGuard`
 * attaches that to `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    public constructor(configService: ConfigService) {
        const secret = configService.get<string>('JWT_SECRET');
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_JWT_EXPIRES_IN;
        assertJwtConfig(secret, expiresIn);
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            // assertJwtConfig threw if `secret` was undefined, so this `as` is a genuine
            // narrowing from `string | undefined` to `string` after the guard above.
            secretOrKey: secret,
            algorithms: ['HS256'],
        });
    }

    public validate(payload: IJwtPayload): IAuthenticatedUser {
        if (typeof payload.sub !== 'number' || !Object.values(UserRoleEnum).includes(payload.role)) {
            throw new UnauthorizedError('AUTH_INVALID_TOKEN');
        }

        return { id: payload.sub, role: payload.role };
    }
}
