import { DomainError } from './DomainError';
import { HTTP_STATUS_GONE } from '../const/CommonConsts';

/**
 * 410 — invitation token not found in the database.
 *
 * HTTP 410 (Gone) is used for all four invitation-redemption error paths so that response
 * timing and status code cannot be used to determine whether a token ever existed
 * (oracle-resistance per auth-and-rbac.md and ADR 0005).
 */
export class InvitationNotFoundError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_GONE,
            code: 'INVITATION_NOT_FOUND',
            message: 'This invitation link is invalid or has already been used.',
            cause,
        });
    }
}
