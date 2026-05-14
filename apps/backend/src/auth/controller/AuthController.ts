import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { IAuthenticatedUser } from '@mes/shared';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '@mes/shared';
import type { Request, Response } from 'express';
import { Public } from '../decorator/Public';
import { CurrentUser } from '../decorator/CurrentUser';
import { LoginDto } from '../dto/LoginDto';
import { SignupDto } from '../dto/SignupDto';
import { IAuthTokenResponse } from '../interface/IAuthTokenResponse';
import { IAuthUserProfile } from '../interface/IAuthUserProfile';
import { AuthService } from '../service/AuthService';
import { RefreshTokenError } from '../../common/error/RefreshTokenError';
import { OriginAllowedGuard } from '../../common/guard/OriginAllowedGuard';
import {
    THROTTLE_LOGIN_LIMIT,
    THROTTLE_WINDOW_MS,
    THROTTLER_DEFAULT_NAME,
    THROTTLE_REFRESH_LIMIT,
    THROTTLE_REFRESH_TTL_MS,
    THROTTLER_REFRESH_NAME,
} from '../const/AuthConsts';
import { NODE_ENV_PRODUCTION } from '../../common/const/CommonConsts';

/**
 * `/auth/*` routes.
 *
 * Cookie concerns are handled here (controller layer) to keep `AuthService`
 * framework-agnostic — the service returns raw token strings and the controller
 * translates them to `Set-Cookie` headers.
 *
 * Cookie attributes per ADR 0007 §2:
 *   `HttpOnly; Secure (prod only); SameSite=Lax; Path=/auth; Max-Age=604800`
 *
 * `@Res({ passthrough: true })` lets Nest still handle the JSON response while
 * the controller manually sets the `Set-Cookie` header. Without `passthrough`,
 * Nest skips serialisation and leaves the response open.
 */
@Controller('auth')
export class AuthController {
    public constructor(private readonly authService: AuthService) {}

    @Public()
    @Post('signup')
    @HttpCode(HttpStatus.CREATED)
    public async signup(@Body() body: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<IAuthTokenResponse> {
        const meta = this.extractRequestMeta(req);
        const { accessToken, refreshToken } = await this.authService.signup(body, meta);

        this.setRefreshCookie(res, refreshToken.raw, refreshToken.expiresAt);

        return accessToken;
    }

    @Public()
    @Throttle({ [THROTTLER_DEFAULT_NAME]: { limit: THROTTLE_LOGIN_LIMIT, ttl: THROTTLE_WINDOW_MS } })
    @Post('login')
    @HttpCode(HttpStatus.OK)
    public async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<IAuthTokenResponse> {
        const meta = this.extractRequestMeta(req);
        const { accessToken, refreshToken } = await this.authService.login(body, meta);

        this.setRefreshCookie(res, refreshToken.raw, refreshToken.expiresAt);

        return accessToken;
    }

    @Get('me')
    public async me(@CurrentUser() user: IAuthenticatedUser): Promise<IAuthUserProfile> {
        return this.authService.getProfile(user.id);
    }

    /**
     * Silent-refresh endpoint. Called on app boot and transparently before access-JWT
     * expiry by the SPA's `apiClient`.
     *
     * The CSRF defence stack (layer 2 + 3 of ADR 0007 §8) is applied via
     * `OriginAllowedGuard` which checks `X-Requested-With` and `Origin`/`Referer`.
     * `@UseGuards` is used here because `OriginAllowedGuard` is NOT a global guard
     * (it only applies to cookie-bearing endpoints, not every route).
     *
     * Throttle: per-cookie when present (avoids punishing CGNAT users), falling back
     * to IP. The named `refresh` throttler must be registered in `AppModule`.
     */
    @Public()
    @UseGuards(OriginAllowedGuard)
    @Throttle({ [THROTTLER_REFRESH_NAME]: { limit: THROTTLE_REFRESH_LIMIT, ttl: THROTTLE_REFRESH_TTL_MS } })
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    public async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<IAuthTokenResponse> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const rawCookieValue = req.cookies[REFRESH_COOKIE_NAME];
        const rawToken = typeof rawCookieValue === 'string' ? rawCookieValue : undefined;

        if (!rawToken) {
            throw new RefreshTokenError('REFRESH_TOKEN_MISSING');
        }

        const meta = this.extractRequestMeta(req);
        const { accessToken, refreshToken } = await this.authService.refresh(rawToken, meta);

        this.setRefreshCookie(res, refreshToken.raw, refreshToken.expiresAt);

        return accessToken;
    }

    /**
     * Logout — revokes the single refresh token in the cookie.
     * Idempotent: returns 200 even if the cookie is absent or the token is already revoked.
     * Cookie is cleared with attribute parity (ADR 0007 §11).
     */
    @Public()
    @UseGuards(OriginAllowedGuard)
    @Throttle({ [THROTTLER_REFRESH_NAME]: { limit: THROTTLE_REFRESH_LIMIT, ttl: THROTTLE_REFRESH_TTL_MS } })
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    public async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const rawCookieValue = req.cookies[REFRESH_COOKIE_NAME];

        // Item 5: guard against duplicate-cookie array coercion (idempotent no-op for invalid input).
        const rawToken = typeof rawCookieValue === 'string' ? rawCookieValue : undefined;

        await this.authService.logout(rawToken);
        this.clearRefreshCookie(res);
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private extractRequestMeta(req: Request): { userAgent: string | null; ip: string | null } {
        return {
            userAgent: req.headers['user-agent'] ?? null,
            ip: req.ip ?? null,
        };
    }

    private setRefreshCookie(res: Response, raw: string, expiresAt: Date): void {
        const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
        const isProduction = process.env.NODE_ENV === NODE_ENV_PRODUCTION;

        res.cookie(REFRESH_COOKIE_NAME, raw, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: REFRESH_COOKIE_PATH,
            maxAge: maxAge * 1_000, // Express cookie() maxAge is in milliseconds
        });
    }

    private clearRefreshCookie(res: Response): void {
        const isProduction = process.env.NODE_ENV === NODE_ENV_PRODUCTION;

        res.cookie(REFRESH_COOKIE_NAME, '', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: REFRESH_COOKIE_PATH,
            maxAge: 0,
        });
    }
}
