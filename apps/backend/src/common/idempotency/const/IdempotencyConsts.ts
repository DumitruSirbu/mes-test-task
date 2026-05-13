/**
 * Idempotency constants — single source of truth for the interceptor + service.
 *
 * - Header name is fixed (`Idempotency-Key`, case-insensitive at the HTTP layer).
 * - Key format constraints mirror data-model.md + ADR 0006: length 8–64, charset `[A-Za-z0-9_-]`.
 * - PG_UNIQUE_VIOLATION is duplicated from AuthConsts so this module does not depend
 *   on `auth/` (cross-module direction is forbidden per overview.md — `common` depends
 *   on nothing).
 */
export const IDEMPOTENCY_HEADER_NAME = 'idempotency-key';
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 64;
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
export const IDEMPOTENCY_PG_UNIQUE_VIOLATION = '23505';
