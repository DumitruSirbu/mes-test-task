/**
 * Refresh token flow error codes.
 * Returned in 401/403 error responses from `/auth/refresh` and `/auth/logout` endpoints.
 * Per ADR 0005 amendment, these are the canonical error codes observable in structured logs and API responses.
 * Backend observability is based on these stable code values; frontend 401 handler branches on `AUTH_TOKEN_EXPIRED` to trigger retry.
 *
 * Notes on scope:
 * - `REFRESH_TOKEN_RETENTION_BREACH` (§11 of ADR 0007) is server-side only (cleanup job hard-fallback assertion) — not in this wire-error union.
 * - `REFRESH_TOKEN_REUSED` is logged as a security signal but only reaches clients as 401 via the grace-path or theft-path logic.
 *
 * Renamed from `IRefreshErrorCode` — the `I` prefix convention applies to interfaces,
 * not type aliases. This is a string-union type.
 */
export type RefreshErrorCode =
    | 'REFRESH_TOKEN_MISSING' // No refresh token found in the cookie jar
    | 'REFRESH_TOKEN_INVALID' // Token hash does not match any row in refresh_tokens table
    | 'REFRESH_TOKEN_EXPIRED' // Token's expires_at is in the past
    | 'REFRESH_TOKEN_REUSED' // Token was already used and family must be revoked (replay attack detected)
    | 'REFRESH_CSRF_REJECTED'; // Origin/Referer guard rejected the request or X-Requested-With header missing

/**
 * @deprecated Use `RefreshErrorCode` instead. Kept for backward compatibility during migration.
 */
export type IRefreshErrorCode = RefreshErrorCode;
