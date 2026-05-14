/**
 * BullMQ queue name for outbound invitation emails.
 *
 * A single constant here is the single source of truth for both the producer
 * (`PurchasesService`) and the consumer (`InvitationEmailProcessor`). Never inline
 * the string — use this constant everywhere per code-conventions.md.
 */
export const INVITATION_EMAIL_QUEUE = 'invitation-email';

/**
 * BullMQ job name within `INVITATION_EMAIL_QUEUE`.
 * Matches the async-jobs.md queue inventory table.
 */
export const INVITATION_EMAIL_JOB_NAME = 'invitation.email.send';

/**
 * Retry policy for invitation email jobs (ADR 0006).
 * Five attempts with exponential backoff starting at 2 s.
 * Natural sequence: 2 s, 4 s, 8 s, 16 s, 32 s — all under the 60 s cap.
 *
 * Implicit cap check: 2_000 * 2 ** (INVITATION_EMAIL_ATTEMPTS - 1) = 32_000 ms < 60_000 ms.
 * A regression test in NotificationsConsts.spec.ts asserts this invariant so any future
 * bump to INVITATION_EMAIL_ATTEMPTS that would exceed the 60 s cap trips CI.
 */
export const INVITATION_EMAIL_ATTEMPTS = 5;
export const INVITATION_EMAIL_BACKOFF_DELAY_MS = 2_000;
export const INVITATION_EMAIL_BACKOFF_CAP_MS = 60_000;

/**
 * Completed-job retention: keep jobs for 24 h or up to 1 000 entries, whichever is hit first.
 */
export const INVITATION_EMAIL_REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400;
export const INVITATION_EMAIL_REMOVE_ON_COMPLETE_COUNT = 1_000;

/**
 * Failed-job retention: keep failed jobs for 7 days or up to 1 000 entries.
 * Prevents unbounded PII accumulation in Redis while retaining enough history for debugging.
 */
export const INVITATION_EMAIL_REMOVE_ON_FAIL_AGE_SECONDS = 7 * 24 * 3_600;
export const INVITATION_EMAIL_REMOVE_ON_FAIL_COUNT = 1_000;

/**
 * Deterministic jobId prefix for invitation-email jobs.
 * Combined with the invitationId, this gives a stable key that BullMQ uses to
 * deduplicate jobs — layer 1 of the three-layer idempotency stack (ADR 0006).
 */
export const INVITATION_EMAIL_JOB_ID_PREFIX = 'invitation-email-';

/**
 * Default Redis connection values used when `REDIS_HOST` / `REDIS_PORT` env vars
 * are absent. Never inline these strings/numbers — reference these constants.
 */
export const REDIS_DEFAULT_HOST = 'localhost';
export const REDIS_DEFAULT_PORT = 6379;

/**
 * Mount path for the Bull Board admin UI.
 * Protected by `BullBoardAuthMiddleware` (ADMIN role required).
 */
export const BULL_BOARD_BASE_PATH = '/admin/queues';
