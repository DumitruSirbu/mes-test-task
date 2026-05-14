import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { REFRESH_CSRF_ALLOWED_ORIGINS_FALLBACK, REFRESH_CSRF_ALLOWED_ORIGINS_ENV } from '../const/CommonConsts';
import { RefreshCsrfError } from '../error/RefreshTokenError';
import { XHR_REQUESTED_WITH, XHR_REQUESTED_WITH_HEADER } from '@mes/shared';

/**
 * CSRF defence — layer 3 of the three-layer stack in ADR 0007 §8.
 *
 * Placed in `common/guard/` (not `auth/guard/`) because it is a CORS concern
 * reusable beyond authentication routes.
 *
 * Hard-rejection rules (no implicit allow — ADR 0007 §8):
 *   1. `Origin: null`                          → 403 REFRESH_CSRF_REJECTED
 *   2. Both `Origin` AND `Referer` absent      → 403 REFRESH_CSRF_REJECTED
 *   3. `Origin` present, not in allow-list     → 403 REFRESH_CSRF_REJECTED
 *   4. `Referer` only (no Origin): hostname
 *      not in allow-list                       → 403 REFRESH_CSRF_REJECTED
 *   5. `X-Requested-With` !== 'XMLHttpRequest' → 403 REFRESH_CSRF_REJECTED
 *
 * Allow-list is read once at construction from `CORS_ALLOWED_ORIGINS` (comma-separated).
 */
@Injectable()
export class OriginAllowedGuard implements CanActivate {
    private readonly allowedOrigins: ReadonlySet<string>;

    public constructor(configService: ConfigService) {
        const raw = configService.get<string>(REFRESH_CSRF_ALLOWED_ORIGINS_ENV) ?? '';
        const parsed = raw
            .split(',')
            .map((o) => o.trim())
            .filter((o) => o.length > 0);

        this.allowedOrigins = new Set(parsed.length > 0 ? parsed : REFRESH_CSRF_ALLOWED_ORIGINS_FALLBACK);
    }

    public canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();

        this.assertXhrHeader(request);
        this.assertOriginOrReferer(request);

        return true;
    }

    private assertXhrHeader(request: Request): void {
        const xrw = request.headers[XHR_REQUESTED_WITH_HEADER.toLowerCase()];

        if (xrw !== XHR_REQUESTED_WITH) {
            throw new RefreshCsrfError('X-Requested-With header missing or not XMLHttpRequest');
        }
    }

    private assertOriginOrReferer(request: Request): void {
        const origin = request.headers['origin'];
        const referer = request.headers['referer'];

        if (origin === 'null') {
            throw new RefreshCsrfError('Origin: null — sandboxed iframe or file:// source rejected');
        }

        if (!origin && !referer) {
            throw new RefreshCsrfError('Both Origin and Referer are absent');
        }

        if (origin) {
            if (!this.allowedOrigins.has(origin)) {
                throw new RefreshCsrfError(`Origin not in allow-list: ${origin}`);
            }

            return;
        }

        // Referer-only path: parse the origin part (scheme + host) and check.
        const refererOrigin = this.extractOriginFromReferer(referer as string);

        if (!refererOrigin || !this.allowedOrigins.has(refererOrigin)) {
            throw new RefreshCsrfError(`Referer origin not in allow-list: ${referer}`);
        }
    }

    private extractOriginFromReferer(referer: string): string | null {
        try {
            const url = new URL(referer);

            return `${url.protocol}//${url.host}`;
        } catch {
            return null;
        }
    }
}
