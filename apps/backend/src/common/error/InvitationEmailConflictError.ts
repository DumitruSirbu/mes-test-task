import { DomainError } from './DomainError';
import { HTTP_STATUS_GONE } from '../const/CommonConsts';

/**
 * 410 — the invitation's `student_email` already belongs to an existing user account.
 *
 * HTTP 410 is used for oracle-resistance — returning 409 Conflict would reveal that the
 * email exists in the `users` table (see auth-and-rbac.md and ADR 0005).
 */
export class InvitationEmailConflictError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_GONE,
            code: 'INVITATION_EMAIL_CONFLICT',
            message: 'This invitation link is invalid or has already been used.',
            cause,
        });
    }
}
