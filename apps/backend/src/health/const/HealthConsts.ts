/**
 * Timeout applied to the Redis PING command. If Redis is TCP-connected but not responding
 * (e.g. a stalled replica), the race deadline ensures the health probe completes within a
 * predictable bound rather than hanging indefinitely.
 *
 * The same value is reused as `connectTimeout` on the ioredis client so the initial
 * connection attempt is also bounded.
 */
export const REDIS_PING_TIMEOUT_MS = 1500;

/**
 * Timeout applied to the Postgres ping check. Mirrors the Redis deadline so both
 * dependencies fail fast within the same readiness-probe window.
 */
export const DB_PING_TIMEOUT_MS = 1500;
