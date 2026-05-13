import { DomainError } from './DomainError';

/**
 * 403 — the caller is authenticated but does not hold a role permitted by the route.
 * Raised by `RolesGuard`; the filter normalises Nest's `ForbiddenException` to this code too.
 */
export class ForbiddenError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: 403,
            code: 'AUTH_FORBIDDEN_ROLE',
            message: 'You do not have permission to access this resource.',
            cause,
        });
    }
}
