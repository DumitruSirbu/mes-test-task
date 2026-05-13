/**
 * Base class for every error thrown by services / repositories / processors.
 *
 * Concrete subclasses set `httpStatus` + `code` + a human `message` (English, sentence-cased).
 * The global `HttpExceptionFilter` reads these fields and renders the canonical API error
 * envelope (see ADR 0005). Services never throw `HttpException` — that scatters HTTP
 * concerns through business code and bypasses the canonical JSON shape.
 */
export interface IDomainErrorOptions {
    httpStatus: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
}

export abstract class DomainError extends Error {
    public readonly code: string;
    public readonly httpStatus: number;
    public readonly details?: Record<string, unknown>;
    public override readonly cause?: unknown;

    protected constructor(options: IDomainErrorOptions) {
        super(options.message);
        this.name = new.target.name;
        this.code = options.code;
        this.httpStatus = options.httpStatus;
        this.details = options.details;
        this.cause = options.cause;
        Error.captureStackTrace?.(this, new.target);
    }
}
