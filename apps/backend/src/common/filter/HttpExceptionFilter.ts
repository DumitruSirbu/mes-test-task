import {
    ArgumentsHost,
    BadRequestException,
    Catch,
    ExceptionFilter,
    ForbiddenException,
    HttpException,
    HttpStatus,
    UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import type { Response } from 'express';
import type { IApiErrorResponse } from '@mes/shared';
import { HTTP_STATUS_INTERNAL_SERVER_ERROR, HTTP_STATUS_TOO_MANY_REQUESTS, REQUEST_ID_KEY } from '../const/CommonConsts';
import { DomainError } from '../error/DomainError';

interface INormalisedError {
    httpStatus: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    /** Set to true if the original error already carried domain context (do not re-log raw). */
    isDomain: boolean;
}

/**
 * Global exception filter — single seam between thrown errors and the HTTP response.
 *
 * Mapping rules (in order):
 *   1. DomainError subclass         → use its httpStatus / code / details verbatim.
 *   2. Nest UnauthorizedException   → 401, code chosen from the message hint.
 *   3. Nest ForbiddenException      → 403 AUTH_FORBIDDEN_ROLE.
 *   4. ThrottlerException           → 429 RATE_LIMITED.
 *   5. ValidationPipe BadRequest    → 400 VALIDATION_FAILED with details.fields.
 *   6. Any other HttpException      → its status, code = INTERNAL_ERROR (we don't leak Nest internals).
 *   7. Everything else              → 500 INTERNAL_ERROR; full stack logged, generic message returned.
 *
 * 4xx → warn, 5xx → error. Stack traces never leave the log.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    public constructor(
        private readonly logger: PinoLogger,
        private readonly cls: ClsService,
    ) {
        this.logger.setContext(HttpExceptionFilter.name);
    }

    public catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const response = http.getResponse<Response>();
        const request = http.getRequest<{ method?: string; url?: string }>();
        const requestId = this.cls.get<string>(REQUEST_ID_KEY) ?? '';

        const normalised = this.normalise(exception);
        const body: IApiErrorResponse = {
            code: normalised.code,
            message: normalised.message,
            requestId,
            ...(normalised.details ? { details: normalised.details } : {}),
        };

        this.log(exception, normalised, request);
        response.status(normalised.httpStatus).json(body);
    }

    private normalise(exception: unknown): INormalisedError {
        if (exception instanceof DomainError) {
            return {
                httpStatus: exception.httpStatus,
                code: exception.code,
                message: exception.message,
                details: exception.details,
                isDomain: true,
            };
        }

        if (exception instanceof BadRequestException) {
            return this.normaliseValidationError(exception);
        }

        if (exception instanceof UnauthorizedException) {
            return {
                httpStatus: HttpStatus.UNAUTHORIZED,
                code: this.pickAuthCode(exception),
                message: 'Authentication required.',
                isDomain: false,
            };
        }

        if (exception instanceof ForbiddenException) {
            return {
                httpStatus: HttpStatus.FORBIDDEN,
                code: 'AUTH_FORBIDDEN_ROLE',
                message: 'You do not have permission to access this resource.',
                isDomain: false,
            };
        }

        if (exception instanceof HttpException && exception.getStatus() === HTTP_STATUS_TOO_MANY_REQUESTS) {
            // Filter-normalised ThrottlerException — see auth-and-rbac.md error table.
            // The throttler module itself is wired in M04+; this branch is in place so
            // rate-limit responses already carry the canonical envelope when it lands.
            return {
                httpStatus: 429,
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please retry shortly.',
                isDomain: false,
            };
        }

        if (exception instanceof HttpException) {
            return {
                httpStatus: exception.getStatus(),
                code: 'INTERNAL_ERROR',
                message: 'Something went wrong.',
                isDomain: false,
            };
        }

        return {
            httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong.',
            isDomain: false,
        };
    }

    private normaliseValidationError(exception: BadRequestException): INormalisedError {
        const payload = exception.getResponse();
        const fields: Record<string, string[]> = {};

        if (this.isValidationPayload(payload)) {
            for (const raw of payload.message) {
                if (typeof raw === 'string') {
                    fields._ ??= [];
                    fields._.push(raw);
                } else if (this.isClassValidatorError(raw)) {
                    const field = raw.property ?? '_';
                    fields[field] ??= [];
                    fields[field].push(...Object.values(raw.constraints ?? {}));
                }
            }
        }

        return {
            httpStatus: HttpStatus.BAD_REQUEST,
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: Object.keys(fields).length > 0 ? { fields } : undefined,
            isDomain: false,
        };
    }

    private isValidationPayload(value: unknown): value is { message: unknown[] } {
        return typeof value === 'object' && value !== null && Array.isArray((value as { message?: unknown }).message);
    }

    private isClassValidatorError(value: unknown): value is { property?: string; constraints?: Record<string, string> } {
        return typeof value === 'object' && value !== null && 'property' in value;
    }

    private pickAuthCode(exception: UnauthorizedException): 'AUTH_MISSING_TOKEN' | 'AUTH_INVALID_TOKEN' | 'AUTH_TOKEN_EXPIRED' {
        const message = exception.message.toLowerCase();

        if (message.includes('expired')) {
            return 'AUTH_TOKEN_EXPIRED';
        }

        if (message.includes('no auth token') || message.includes('missing')) {
            return 'AUTH_MISSING_TOKEN';
        }

        return 'AUTH_INVALID_TOKEN';
    }

    private log(exception: unknown, normalised: INormalisedError, request: { method?: string; url?: string }): void {
        const meta = {
            code: normalised.code,
            httpStatus: normalised.httpStatus,
            method: request.method,
            path: request.url?.split('?')[0],
        };

        if (normalised.httpStatus >= HTTP_STATUS_INTERNAL_SERVER_ERROR) {
            this.logger.error({ err: exception, ...meta }, 'Unhandled exception');

            return;
        }

        if (normalised.isDomain) {
            this.logger.warn(meta, normalised.code);
        } else {
            const errName = exception instanceof Error ? exception.constructor.name : 'UnknownError';
            const errMessage = exception instanceof Error ? exception.message : String(exception);
            this.logger.warn({ ...meta, errName, errMessage }, normalised.code);
        }
    }
}
