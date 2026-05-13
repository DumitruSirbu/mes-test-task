import { DomainError } from './DomainError';

/**
 * 401 — any failure to authenticate the caller.
 *
 * The constructor sub-code lets the same class cover the four documented
 * unauthenticated branches without proliferating subclasses:
 *
 *   - `AUTH_MISSING_TOKEN`        — no Authorization header / malformed
 *   - `AUTH_INVALID_TOKEN`        — bad signature / wrong `alg` / unknown `kid`
 *   - `AUTH_TOKEN_EXPIRED`        — `exp` past
 *   - `AUTH_INVALID_CREDENTIALS`  — login email/password mismatch
 *
 * See `auth-and-rbac.md` for the canonical mapping table.
 */
export type UnauthorizedCodeType = 'AUTH_MISSING_TOKEN' | 'AUTH_INVALID_TOKEN' | 'AUTH_TOKEN_EXPIRED' | 'AUTH_INVALID_CREDENTIALS';

const MESSAGE_BY_CODE: Record<UnauthorizedCodeType, string> = {
    AUTH_MISSING_TOKEN: 'Authentication required.',
    AUTH_INVALID_TOKEN: 'Authentication token is invalid.',
    AUTH_TOKEN_EXPIRED: 'Authentication token has expired.',
    AUTH_INVALID_CREDENTIALS: 'Invalid email or password.',
};

export class UnauthorizedError extends DomainError {
    public constructor(code: UnauthorizedCodeType, cause?: unknown) {
        super({
            httpStatus: 401,
            code,
            message: MESSAGE_BY_CODE[code],
            cause,
        });
    }
}
