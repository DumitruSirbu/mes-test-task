import { DomainError } from './DomainError';

/**
 * 400 — `POST /purchases` (or any `@Idempotent()` route) was called without a valid
 * `Idempotency-Key` header. The frontend always supplies one — this fires only on
 * direct API calls / client bugs.
 */
export class IdempotencyKeyRequiredError extends DomainError {
    public constructor(message = 'Idempotency-Key header is required.', cause?: unknown) {
        super({
            httpStatus: 400,
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message,
            cause,
        });
    }
}
