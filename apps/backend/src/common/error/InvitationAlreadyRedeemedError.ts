import { DomainError } from './DomainError';
import { HTTP_STATUS_GONE } from '../const/CommonConsts';

/**
 * 410 — invitation token was already redeemed (status = 'REDEEMED').
 *
 * HTTP 410 is used for oracle-resistance (all invitation failure paths return the same
 * status code — see auth-and-rbac.md and ADR 0005).
 */
export class InvitationAlreadyRedeemedError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_GONE,
            code: 'INVITATION_ALREADY_REDEEMED',
            message: 'This invitation link has already been used.',
            cause,
        });
    }
}
