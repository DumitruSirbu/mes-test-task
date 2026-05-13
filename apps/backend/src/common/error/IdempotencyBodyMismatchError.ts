import { DomainError } from './DomainError';

/**
 * 409 — same `Idempotency-Key` was reused with a different request body. Per ADR 0006
 * this is a permanent client error — the client MUST pick a new key and MUST NOT retry.
 */
export class IdempotencyBodyMismatchError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: 409,
            code: 'IDEMPOTENCY_BODY_MISMATCH',
            message: 'This idempotency key was used with a different request body. Pick a new key and do not retry.',
            cause,
        });
    }
}
