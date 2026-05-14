import { Injectable } from '@nestjs/common';
import { REFRESH_COOKIE_NAME } from '@mes/shared';
import { ProxyAwareThrottlerGuard } from './ProxyAwareThrottlerGuard';

/**
 * Throttler guard for cookie-bearing endpoints (`/auth/refresh`, `/auth/logout`).
 *
 * Bucket key preference (ADR 0007 — CGNAT-friendly per-cookie throttling):
 *   1. `mes_rt` cookie value — isolates each session even when many users share
 *      the same outbound IP (CGNAT, corporate NAT).
 *   2. Falls back to the parent `ProxyAwareThrottlerGuard` key (user id → first
 *      X-Forwarded-For hop → req.ip) when the cookie is absent (e.g. the
 *      REFRESH_TOKEN_MISSING path, where we still want to rate-limit by IP).
 *
 * Applied via `@Throttle({ refresh: ... })` on `/auth/refresh` and `/auth/logout`
 * only — the global APP_GUARD throttler remains `ProxyAwareThrottlerGuard`.
 */
@Injectable()
export class CookieAwareThrottlerGuard extends ProxyAwareThrottlerGuard {
    protected override async getTracker(req: Record<string, unknown>): Promise<string> {
        const cookies = req['cookies'] as Record<string, string | string[] | undefined> | undefined;
        const rawCookie = cookies?.[REFRESH_COOKIE_NAME];

        if (typeof rawCookie === 'string' && rawCookie.length > 0) {
            return `cookie:${rawCookie}`;
        }

        return super.getTracker(req);
    }
}
