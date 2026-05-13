import { DomainError } from './DomainError';

/**
 * 400 — request body / query failed validation.
 *
 * `details.fields` carries the per-field reason map produced by `ValidationPipe`
 * (or by a Zod parser at a controller boundary). The filter normalises Nest's
 * `BadRequestException` payload to this shape.
 */
export class ValidationFailedError extends DomainError {
    public constructor(fields: Record<string, string[]>, cause?: unknown) {
        super({
            httpStatus: 400,
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: { fields },
            cause,
        });
    }
}
