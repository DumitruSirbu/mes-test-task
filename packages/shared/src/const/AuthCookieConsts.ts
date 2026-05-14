/**
 * Refresh token cookie configuration constants.
 * Shared between backend (cookie issuer, guard) and frontend (apiClient cookie handler).
 * Per ADR 0007 §4: the `/auth` path is architecturally load-bearing — renaming invalidates live cookies.
 */

/**
 * Cookie name for the refresh token.
 * Used in `Set-Cookie` header and client-side inspection.
 */
export const REFRESH_COOKIE_NAME = 'mes_rt';

/**
 * Cookie path restricting the refresh token to auth endpoints.
 * Matches the `/auth/*` route prefix where `/auth/refresh` and `/auth/logout` live.
 * Architectural constraint per ADR 0007: renaming the auth module requires a cookie migration strategy.
 */
export const REFRESH_COOKIE_PATH = '/auth';

/**
 * XHR (fetch/XMLHttpRequest) header canonical value.
 * Required on `/auth/refresh` and `/auth/logout` POST requests as CSRF defense (§9 of ADR 0007).
 * Prevents cross-site form POST (forms cannot set custom headers).
 */
export const XHR_REQUESTED_WITH = 'XMLHttpRequest';

/**
 * XHR header name.
 * Used by backend guard and frontend apiClient to reference the header name from a single source of truth,
 * ensuring the string is never misspelled and changes propagate atomically.
 */
export const XHR_REQUESTED_WITH_HEADER = 'X-Requested-With';
