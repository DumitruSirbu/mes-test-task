import { DomainError } from './DomainError';
import type { RefreshErrorCode } from '@mes/shared';

/**
 * 401 — refresh token validation failed.
 *
 * Covers the four documented refresh-token branches (ADR 0007 §5):
 *   - `REFRESH_TOKEN_MISSING`  — cookie absent at `/auth/refresh`
 *   - `REFRESH_TOKEN_INVALID`  — hash not found in `refresh_tokens`
 *   - `REFRESH_TOKEN_EXPIRED`  — row exists but `expires_at <= now()`
 *   - `REFRESH_TOKEN_REUSED`   — family revoked after replay-attack detection
 */
const REFRESH_MESSAGE_BY_CODE: Record<RefreshErrorCode, string> = {
    REFRESH_TOKEN_MISSING: 'Refresh token is missing.',
    REFRESH_TOKEN_INVALID: 'Refresh token is invalid.',
    REFRESH_TOKEN_EXPIRED: 'Refresh token has expired.',
    REFRESH_TOKEN_REUSED: 'Refresh token has already been used.',
    REFRESH_CSRF_REJECTED: 'Request origin is not permitted.',
};

export type RefreshTokenErrorCode = Exclude<RefreshErrorCode, 'REFRESH_CSRF_REJECTED'>;

export class RefreshTokenError extends DomainError {
    public constructor(code: RefreshTokenErrorCode, cause?: unknown) {
        super({
            httpStatus: 401,
            code,
            message: REFRESH_MESSAGE_BY_CODE[code],
            cause,
        });
    }
}

/**
 * 403 — CSRF guard rejected the refresh/logout request.
 *
 * Separate class from `RefreshTokenError` because the HTTP status differs
 * (403 vs 401) and the guard throws this directly without going through the
 * service layer.
 */
export class RefreshCsrfError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: 403,
            code: 'REFRESH_CSRF_REJECTED',
            message: REFRESH_MESSAGE_BY_CODE['REFRESH_CSRF_REJECTED'],
            cause,
        });
    }
}
