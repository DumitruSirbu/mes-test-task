/**
 * Argon2id parameters — OWASP 2024 baseline (see auth-and-rbac.md). Bumping `parallelism`
 * offers little defence against attackers with GPUs and raises per-login CPU cost on the
 * server linearly; keep at 1 unless a security review revisits the trade-off.
 *
 * Memory cost is in KiB per the argon2 package (65536 → 64 MiB).
 */
export const ARGON2_MEMORY_COST = 65536;
export const ARGON2_TIME_COST = 3;
export const ARGON2_PARALLELISM = 1;

/**
 * Default access-token TTL when `JWT_EXPIRES_IN` is unset.
 * Lowered from 15 → 10 minutes per ADR 0007 (same blast-radius posture, half the refresh chatter).
 */
export const DEFAULT_JWT_EXPIRES_IN = '10m';

/**
 * Fallback TTL in seconds, derived from DEFAULT_JWT_EXPIRES_IN ('10m' = 600 s).
 * Used when `JWT_EXPIRES_IN` cannot be parsed so the magic number 600 never appears inline.
 */
export const DEFAULT_JWT_EXPIRES_IN_SECONDS = 600;

/**
 * Valid format for JWT_EXPIRES_IN: a positive integer followed by s, m, h, or d.
 * Plain integers (bare seconds) are also accepted by the `ms` library but we restrict
 * to time-unit strings to prevent accidental millisecond values slipping in.
 */
export const JWT_EXPIRES_IN_REGEX = /^\d+[smhd]$/;

/**
 * Minimum required byte length for JWT_SECRET. Enforced at boot by `assertJwtConfig`.
 * 32 characters yields ≥ 256 bits of entropy for HS256.
 */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * PostgreSQL unique-violation SQLSTATE code. Used to distinguish duplicate-key errors
 * from other database failures without relying on driver-specific error message strings.
 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Compile-time invalid argon2id hash used as the timing dummy on the unknown-email login path.
 *
 * Using a precomputed string ensures `verifyDummy` can run immediately — even on the first
 * request before `onModuleInit` has completed — and produces a well-formed argon2id record
 * that `argon2.verify` will reject cleanly (invalid encoded hash content) rather than
 * throwing a format error.
 */
export const DUMMY_HASH_SENTINEL = '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Shared time-window for all throttle buckets: 60 seconds.
 * Both the global default and the login-specific throttler use this window;
 * only the request limits differ.
 */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * Global rate-limit applied to every route by `ProxyAwareThrottlerGuard` (APP_GUARD in AppModule).
 * 60 requests per window is a generous default for authenticated API traffic.
 */
export const THROTTLE_DEFAULT_LIMIT = 60;

/**
 * Strict rate-limit applied to `/auth/login` only.
 * 5 attempts per window per bucket mitigates credential-stuffing at low cost.
 */
export const THROTTLE_LOGIN_LIMIT = 5;

/**
 * Named throttler key used in `@Throttle({ [THROTTLER_DEFAULT_NAME]: { ... } })`.
 * Must match the `name` field in `ThrottlerModule.forRoot` configuration.
 */
export const THROTTLER_DEFAULT_NAME = 'default';

/**
 * Standard HTTP Bearer token prefix used when parsing the `Authorization` header.
 * Single source of truth — never inline `'Bearer '` in middleware or guards.
 */
export const BEARER_PREFIX = 'Bearer ';

/**
 * Refresh token TTL in days (ADR 0007 §1). Sliding — every successful rotation
 * issues a new token with a fresh 7-day `expires_at`.
 */
export const REFRESH_TOKEN_TTL_DAYS = 7;

/**
 * Entropy size for the raw opaque refresh token in bytes.
 * 32 bytes → 256-bit random value, `base64url`-encoded.
 */
export const REFRESH_TOKEN_BYTES = 32;

/**
 * Grace window in seconds for the legitimate-retry path of reuse-detection (ADR 0007 §7).
 * A revoked token arriving within this window from the same `user_agent` is treated as a
 * network retry, not theft. Tightening reduces the replay surface; loosening reduces
 * false-positive logouts for mobile clients.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

/**
 * Retention: expired rows are kept for this many additional days after `expires_at`
 * passes before the cleanup job deletes them (forensic grace window — ADR 0007 §10).
 */
export const REFRESH_TOKEN_GRACE_DAYS = 7;

/**
 * Retention: revoked rows are kept for this many days after `revoked_at`
 * (forensic window for theft investigations — ADR 0007 §10).
 */
export const REFRESH_TOKEN_FORENSIC_DAYS = 30;

/**
 * Hard retention ceiling: rows still present beyond this many days trigger a
 * `REFRESH_TOKEN_RETENTION_BREACH` error log (cleanup job silence detector — ADR 0007 §10).
 */
export const REFRESH_TOKEN_RETENTION_BREACH_DAYS = 60;

/**
 * Per-cookie (falling back to per-IP) rate-limit applied to `/auth/refresh`.
 * 30 requests per 60-second window accommodates legitimate rapid-refresh scenarios
 * (page reload storms, multi-tab) while blocking brute-force replays.
 */
export const THROTTLE_REFRESH_LIMIT = 30;

/**
 * Time window in ms for the `/auth/refresh` throttle bucket.
 * Mirrors `THROTTLE_WINDOW_MS` so all throttle windows are consistent.
 */
export const THROTTLE_REFRESH_TTL_MS = 60_000;

/**
 * Named throttler key for the `/auth/refresh` endpoint.
 * Must be registered in `ThrottlerModule.forRoot` alongside the `default` name
 * if custom per-endpoint limits are to be applied via `@Throttle`.
 */
export const THROTTLER_REFRESH_NAME = 'refresh';

/**
 * Milliseconds in a single calendar day.
 * Used by `computeExpiresAt` to avoid repeating the inline expression
 * `24 * 60 * 60 * 1_000` throughout the service.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1_000;
