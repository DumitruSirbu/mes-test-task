import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import type { Request, Response } from 'express';
import type { IAuthenticatedUser } from '@mes/shared';
import { IDEMPOTENT_KEY } from '../decorator/Idempotent';
import { IDEMPOTENCY_HEADER_NAME, IDEMPOTENCY_KEY_REGEX } from '../const/IdempotencyConsts';
import { hashCanonicalBody } from '../util/canonicaliseBody';
import { IdempotencyService } from '../service/IdempotencyService';
import { IdempotencyKeyRequiredError } from '../../error/IdempotencyKeyRequiredError';
import { IdempotencyBodyMismatchError } from '../../error/IdempotencyBodyMismatchError';
import { UnauthorizedError } from '../../error/UnauthorizedError';
import type { IIdempotencyContext } from '../interface/IIdempotencyContext';

interface IRequestWithContext extends Request {
    user?: IAuthenticatedUser;
    idempotencyContext?: IIdempotencyContext;
}

/**
 * Global interceptor that enforces the idempotency protocol on handlers marked `@Idempotent()`.
 *
 * Flow per ADR 0006:
 *   1. Validate the `Idempotency-Key` header (length 8–64, charset `[A-Za-z0-9_-]`). Reject
 *      malformed / missing keys with `IDEMPOTENCY_KEY_REQUIRED` BEFORE any DB read.
 *   2. Canonicalise the body, hash it (`request_hash = SHA-256(JCS-ish(body))`).
 *   3. Look up `(user_id, endpoint, key)`:
 *        - hit, matching hash → replay the stored response_status/body verbatim, log IDEMPOTENCY_REPLAY.
 *        - hit, different hash → throw `IdempotencyBodyMismatchError` (409).
 *   4. Miss → stash `{ key, endpoint, userId, requestHash }` on the request and pass to handler.
 *      The handler's service is responsible for persisting the response row in the same
 *      transaction as the business write (via `IdempotencyService.persistWithinTransaction`).
 *
 * Routes WITHOUT `@Idempotent()` pass through with zero overhead.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    private readonly logger = new Logger(IdempotencyInterceptor.name);

    public constructor(
        private readonly reflector: Reflector,
        private readonly idempotencyService: IdempotencyService,
    ) {}

    public async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);

        if (!isIdempotent) {
            return next.handle();
        }

        const http = context.switchToHttp();
        const request = http.getRequest<IRequestWithContext>();
        const response = http.getResponse<Response>();

        const user = request.user;

        if (!user) {
            // `@Idempotent()` is only useful on authenticated routes — the key is scoped by user.
            throw new UnauthorizedError('AUTH_MISSING_TOKEN');
        }

        const rawKey = this.readHeader(request, IDEMPOTENCY_HEADER_NAME);

        if (!rawKey || !IDEMPOTENCY_KEY_REGEX.test(rawKey)) {
            throw new IdempotencyKeyRequiredError();
        }

        const endpoint = this.endpointSignature(request);
        const requestHash = hashCanonicalBody(request.body);

        const existing = await this.idempotencyService.findReplay(user.id, endpoint, rawKey);

        if (existing) {
            if (existing.requestHash !== requestHash) {
                throw new IdempotencyBodyMismatchError();
            }

            this.logger.log(`code=IDEMPOTENCY_REPLAY userId=${user.id} endpoint=${endpoint} key=${rawKey}`);
            response.status(existing.responseStatus);

            return of(existing.responseBody);
        }

        request.idempotencyContext = {
            key: rawKey,
            endpoint,
            userId: user.id,
            requestHash,
        };

        return next.handle();
    }

    private readHeader(request: IRequestWithContext, name: string): string | null {
        const value = request.headers[name];

        if (typeof value === 'string') {
            return value.trim();
        }

        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
            return value[0].trim();
        }

        return null;
    }

    private endpointSignature(request: IRequestWithContext): string {
        const method = (request.method ?? 'POST').toUpperCase();
        const rawRoute = (request as { route?: { path?: unknown } }).route?.path;
        const path = typeof rawRoute === 'string' ? rawRoute : (request.url ?? '').split('?')[0];

        return `${method} ${path}`;
    }
}
