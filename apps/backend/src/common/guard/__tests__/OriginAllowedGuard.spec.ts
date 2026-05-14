/**
 * Unit tests for OriginAllowedGuard (M10).
 *
 * Covers all hard-rejection rules from ADR 0007 §9:
 *   1. X-Requested-With absent or wrong value → 403 REFRESH_CSRF_REJECTED
 *   2. Origin: null → 403
 *   3. Both Origin and Referer absent → 403
 *   4. Origin present, not in allow-list → 403
 *   5. Referer-only with allow-listed origin → allowed
 *   6. Referer-only with non-allow-listed origin → 403
 *   7. Valid Origin + valid header → allowed
 */

import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OriginAllowedGuard } from '../OriginAllowedGuard';
import { RefreshCsrfError } from '../../error/RefreshTokenError';

const buildContext = (headers: Record<string, string | undefined>): ExecutionContext => {
    const request = { headers };

    return {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;
};

const buildGuard = (allowedOrigins?: string): OriginAllowedGuard => {
    const configService = {
        get: (key: string) => (key === 'CORS_ALLOWED_ORIGINS' ? (allowedOrigins ?? '') : undefined),
    } as unknown as ConfigService;

    return new OriginAllowedGuard(configService);
};

const ALLOWED = 'http://localhost:5173';
const GUARD = buildGuard(ALLOWED);
const XRW_VALID = { 'x-requested-with': 'XMLHttpRequest' };

describe('OriginAllowedGuard', () => {
    // -------------------------------------------------------------------------
    // X-Requested-With header checks
    // -------------------------------------------------------------------------

    it('rejects when X-Requested-With header is absent', () => {
        const ctx = buildContext({ origin: ALLOWED });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    it('rejects when X-Requested-With has the wrong value', () => {
        const ctx = buildContext({ origin: ALLOWED, 'x-requested-with': 'fetch' });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    it('throws RefreshCsrfError (403) when X-Requested-With missing', () => {
        const ctx = buildContext({ origin: ALLOWED });

        let error: unknown;
        try {
            GUARD.canActivate(ctx);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(RefreshCsrfError);
        expect((error as RefreshCsrfError).httpStatus).toBe(403);
        expect((error as RefreshCsrfError).code).toBe('REFRESH_CSRF_REJECTED');
    });

    // -------------------------------------------------------------------------
    // Origin: null
    // -------------------------------------------------------------------------

    it('rejects when Origin is the literal string "null"', () => {
        const ctx = buildContext({ ...XRW_VALID, origin: 'null' });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    // -------------------------------------------------------------------------
    // Both Origin and Referer absent
    // -------------------------------------------------------------------------

    it('rejects when both Origin and Referer headers are absent', () => {
        const ctx = buildContext({ ...XRW_VALID });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    // -------------------------------------------------------------------------
    // Origin not in allow-list
    // -------------------------------------------------------------------------

    it('rejects when Origin is present but not in the allow-list', () => {
        const ctx = buildContext({ ...XRW_VALID, origin: 'http://evil.example.com' });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    it('rejects even when Referer is valid if Origin is disallowed', () => {
        const ctx = buildContext({
            ...XRW_VALID,
            origin: 'http://evil.example.com',
            referer: `${ALLOWED}/some/path`,
        });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    // -------------------------------------------------------------------------
    // Allowed paths
    // -------------------------------------------------------------------------

    it('allows when Origin is in the allow-list and X-Requested-With is correct', () => {
        const ctx = buildContext({ ...XRW_VALID, origin: ALLOWED });

        expect(GUARD.canActivate(ctx)).toBe(true);
    });

    it('allows second allowed origin when the env has two comma-separated origins', () => {
        const guard = buildGuard('http://localhost:5173,http://localhost:5174');
        const ctx = buildContext({ ...XRW_VALID, origin: 'http://localhost:5174' });

        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows when only Referer is present and its origin is in the allow-list', () => {
        const ctx = buildContext({
            ...XRW_VALID,
            referer: `${ALLOWED}/admin/parents`,
        });

        expect(GUARD.canActivate(ctx)).toBe(true);
    });

    it('rejects when only Referer is present and its origin is NOT in the allow-list', () => {
        const ctx = buildContext({
            ...XRW_VALID,
            referer: 'http://evil.example.com/attack',
        });

        expect(() => GUARD.canActivate(ctx)).toThrow(RefreshCsrfError);
    });

    // -------------------------------------------------------------------------
    // Fallback allow-list when CORS_ALLOWED_ORIGINS is unset
    // -------------------------------------------------------------------------

    it('falls back to localhost:5173 and localhost:5174 when CORS_ALLOWED_ORIGINS is empty', () => {
        const guard = buildGuard(''); // empty → use fallback
        const ctx = buildContext({ ...XRW_VALID, origin: 'http://localhost:5173' });

        expect(guard.canActivate(ctx)).toBe(true);
    });
});
