import { DomainError } from './DomainError';

/**
 * 500 — a DB-level invariant that the application relies on was violated.
 *
 * Thrown when a relation that must be populated by a foreign-key constraint is
 * found to be absent, indicating the database and application are out of sync.
 * This is never a client error — it always signals a deployment or migration
 * problem and should be investigated immediately.
 */
export class DataIntegrityError extends DomainError {
    public constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
        super({
            httpStatus: 500,
            code: 'DATA_INTEGRITY_VIOLATION',
            message,
            details,
            cause,
        });
    }
}
