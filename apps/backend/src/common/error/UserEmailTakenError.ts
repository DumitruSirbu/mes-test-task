import { DomainError } from './DomainError';

/**
 * 409 — `POST /auth/signup` attempted to create a user whose email already exists.
 *
 * Note: the response message is intentionally generic to avoid email-existence enumeration
 * in batch attacks; the email itself is NOT echoed in `details`.
 */
export class UserEmailTakenError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: 409,
            code: 'USER_EMAIL_TAKEN',
            message: 'An account with this email already exists.',
            cause,
        });
    }
}
