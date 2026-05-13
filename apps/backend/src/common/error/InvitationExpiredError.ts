import { DomainError } from './DomainError';
import { HTTP_STATUS_GONE } from '../const/CommonConsts';

/**
 * 410 — invitation token has passed its `expires_at` timestamp.
 *
 * HTTP 410 is used for oracle-resistance (all invitation failure paths return the same
 * status code — see auth-and-rbac.md and ADR 0005).
 */
export class InvitationExpiredError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_GONE,
            code: 'INVITATION_EXPIRED',
            message: 'This invitation link has expired.',
            cause,
        });
    }
}
