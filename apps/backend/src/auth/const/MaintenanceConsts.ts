/**
 * BullMQ queue name for periodic housekeeping jobs (ADR 0004 amendment — ADR 0007 §10).
 *
 * The `maintenance` queue is the canonical home for all domain-agnostic sweep jobs:
 *   - refresh-token-cleanup (M10, first inhabitant)
 *   - idempotency-key sweep (future)
 *   - expired-invitation cleanup (future)
 *
 * Naming convention for jobs inside this queue: `<domain>-cleanup`.
 * Never inline this string — reference this constant everywhere.
 */
export const MAINTENANCE_QUEUE = 'maintenance';

/**
 * BullMQ job name for the refresh-token cleanup repeatable.
 * Schedule: `0 3 * * *` (daily 03:00 UTC).
 */
export const REFRESH_TOKEN_CLEANUP_JOB = 'refresh-token-cleanup';

/**
 * Cron expression for the refresh-token cleanup job.
 * Runs once per day at 03:00 UTC, outside typical peak hours.
 */
export const REFRESH_TOKEN_CLEANUP_CRON = '0 3 * * *';

/**
 * Age in seconds after which completed cleanup jobs are removed from the BullMQ
 * job history. 86 400 s = 24 hours — keeps one day of history for debugging.
 */
export const MAINTENANCE_REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400;

/**
 * Age in seconds after which failed cleanup jobs are removed from the BullMQ job
 * history. 7 * 86 400 s = 7 days — preserves a week of failure history for on-call.
 */
export const MAINTENANCE_REMOVE_ON_FAIL_AGE_SECONDS = 7 * 86_400;

/**
 * Maximum number of completed (or failed) job entries retained in the BullMQ job
 * history, even within the age window. Acts as a hard cap on list growth.
 */
export const MAINTENANCE_RETAIN_COUNT = 100;

/**
 * BullMQ worker `lockDuration` for the maintenance processor, in milliseconds.
 * 10 minutes accommodates the full delete + assertion cycle even on large tables.
 */
export const MAINTENANCE_WORKER_LOCK_DURATION_MS = 10 * 60 * 1_000;

/**
 * BullMQ worker `stalledInterval` for the maintenance processor, in milliseconds.
 * 30 seconds: how often BullMQ checks for stalled jobs.
 */
export const MAINTENANCE_WORKER_STALLED_INTERVAL_MS = 30_000;
