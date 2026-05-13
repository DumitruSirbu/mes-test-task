import { DomainError } from './DomainError';

/**
 * 409 — same `Idempotency-Key` + body, but the original request is still in flight (the
 * stored response row exists with a NULL response body). Clients SHOULD retry after a
 * short backoff. Per ADR 0006.
 *
 * v1 always persists the response body inside the same transaction as the business write,
 * so the NULL window is effectively the UNIQUE-violation race in the interceptor: the
 * second request reaches INSERT before the first one commits. Either way, "retry shortly"
 * is the correct guidance.
 */
export class IdempotencyKeyReusedError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: 409,
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This idempotency key is currently being processed. Please retry shortly.',
            cause,
        });
    }
}
