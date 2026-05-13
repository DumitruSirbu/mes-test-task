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
 * Default access-token TTL when `JWT_EXPIRES_IN` is unset. 15 minutes is the policy
 * ceiling per ADR 0003 — no longer because there is no refresh token in v1.
 */
export const DEFAULT_JWT_EXPIRES_IN = '15m';

/**
 * Fallback TTL in seconds, derived from DEFAULT_JWT_EXPIRES_IN ('15m' = 900 s).
 * Used when `JWT_EXPIRES_IN` cannot be parsed so the magic number 900 never appears inline.
 */
export const DEFAULT_JWT_EXPIRES_IN_SECONDS = 900;

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
