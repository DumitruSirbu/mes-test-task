/**
 * Per-request context populated by `IdempotencyInterceptor` and consumed by services
 * that need to persist the canonical response inside their own transaction.
 *
 * Attached to `request.idempotencyContext` on the Express request (read via Nest's
 * `@Req()` is not allowed in the convention; services read it via the interceptor's
 * helper rather than reaching into the request directly).
 */
export interface IIdempotencyContext {
    key: string;
    endpoint: string;
    userId: number;
    requestHash: string;
}
