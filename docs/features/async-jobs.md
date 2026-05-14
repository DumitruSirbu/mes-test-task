# Feature — Async Jobs (BullMQ)

> **Status:** shipped in M08. BullMQ-backed asynchronous job processing for the invitation email queue.

## Goal

When a parent completes a purchase, the system enqueues an `invitation.email.send` job to BullMQ. A dedicated processor worker consumes the job, performs an idempotent "send" operation (logged to stdout in v1), and handles retries with exponential backoff. Three layers of idempotency (queue, processor, database) ensure the invitation email is never sent twice.

## Surface

### Backend

**Queue Module:**
- `NotificationsModule` — registers the BullMQ queue (`INVITATION_EMAIL_QUEUE`) and the processor.

**Processor:**
- `InvitationEmailProcessor` extending `WorkerHost` — consumes jobs from the queue, validates idempotency, performs the send operation, and handles failures gracefully.

**Producer Integration:**
- `PurchasesService.create()` enqueues the job **after** the purchase + invitation transaction commits (post-commit, never inside the transaction).

**Admin Dashboard:**
- Bull Board mounted at `GET /admin/queues` (ADMIN-gated) — provides a UI for inspecting job state, retrying failed jobs, and viewing payloads.

**Migration:**
- `<ts>-AddEmailSentAtToInvitations.ts` — adds `email_sent_at TIMESTAMPTZ NULL` column to the `invitations` table for idempotency tracking.

## Queue Model

### Queue Configuration

**Queue name constant:** `INVITATION_EMAIL_QUEUE`

**Connection:** Shared Redis instance (host/port from environment variables).

**Job options (set at enqueue time):**
```
attempts: 5
backoff: { type: 'exponential', delay: 2000 }  // 2s, 4s, 8s, 16s, 32s (all under 60s cap)
removeOnComplete: { age: 86400, count: 1000 }  // keep 24h or 1000 most-recent
removeOnFail: { age: 604800, count: 1000 }     // keep 7 days or 1000 failed jobs
jobId: `invitation-email-${payload.invitationId}`  // queue-level idempotency
```

**Job payload:**
```typescript
interface IInvitationEmailJob {
    invitationId: number;
    recipientEmail: string;
    courseTitle: string;
    invitationUrl: string;
}
```

The payload is fully self-contained so the processor can "send" without an extra DB read in the happy path. The processor still loads the invitation row to check idempotency.

## Three Idempotency Layers

### Layer 1: Queue-level (jobId deduplication)

The job is enqueued with a deterministic `jobId` (`invitation-email-${invitationId}`). BullMQ prevents duplicate job records at the same ID — if a parent somehow triggers two enqueues for the same invitation, only one job is queued.

### Layer 2: Processor-level (email_sent_at check)

Before "sending", the processor checks `invitations.email_sent_at IS NULL`:
- If null → proceed with send.
- If not null → invitation was already sent on a prior attempt; log and return success without re-sending (idempotent no-op).

This is the principal idempotency guard: it prevents duplicate sends when the job is retried after a transient failure.

### Layer 3: Database-level (atomic update)

The `markEmailSent(invitationId)` method runs:
```sql
UPDATE invitations
SET email_sent_at = now()
WHERE invitation_id = $id AND email_sent_at IS NULL
RETURNING affected rows count
```

This atomic operation ensures concurrent retries cannot both succeed. The processor detects lost races (another retry already marked the row) by checking the affected row count — if zero, it logs `INVITATION_EMAIL_SEND_LOST_RACE` at info level and returns success (the work was done by the concurrent job).

## Processor Implementation

### `InvitationEmailProcessor`

```typescript
@Processor(INVITATION_EMAIL_QUEUE, {
    concurrency: 2,
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
})
export class InvitationEmailProcessor extends WorkerHost {
    async process(job: Job<IInvitationEmailJob>): Promise<void> {
        // Set request ID for observability
        this.cls.set('requestId', `job:${job.id}`);

        // Load the invitation to check idempotency marker
        const invitation = await this.invitationsRepository.findById(job.data.invitationId);
        if (!invitation) {
            // Invitation deleted between enqueue and process — this is a no-op, not an error
            this.logger.warn(`Invitation ${job.data.invitationId} not found — dropping job`);
            return;
        }
        if (invitation.emailSentAt) {
            // Already sent on a prior attempt — skip
            this.logger.log({
                invitationId: invitation.invitationId,
                emailSentAt: invitation.emailSentAt.toISOString(),
            }, 'Invitation email already sent — skipping');
            return;
        }

        // Log only safe fields (redaction layers per ADR 0005)
        const recipientEmailDomain = job.data.recipientEmail.split('@')[1] ?? 'unknown';
        this.logger.log({
            invitationId: invitation.invitationId,
            recipientEmailDomain,
        }, '[invitation.email.send] would send');

        // Mark as sent (triggers lost-race detection via affected row count)
        const affected = await this.invitationsRepository.markEmailSent(invitation.invitationId);
        if (affected === 0) {
            this.logger.log({
                invitationId: invitation.invitationId,
            }, 'INVITATION_EMAIL_SEND_LOST_RACE — another retry already marked sent');
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error) {
        this.logger.error({
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            totalAttempts: job.opts.attempts,
            errorMessage: err.message,
        }, 'Job failed');
    }
}
```

**Processor options:**
- `concurrency: 2` — process up to 2 jobs in parallel (tunable per queue load).
- `lockDuration: 30_000` — job lock is held for 30s; if the process crashes, BullMQ reclaims the lock after this window and retries.
- `stalledInterval: 30_000` — check for stalled jobs every 30s.
- `maxStalledCount: 1` — mark a job as failed after 1 stall event (move to failed set, not retried).

## Error Handling & Retry

**Transient failures** (e.g., database blip, Redis timeout) are thrown as plain `Error` subclasses. BullMQ catches the throw and schedules the next retry per the `attempts` / `backoff` config.

**Logical no-ops** (invitation already sent, invitation deleted) are handled with early `return` and a structured log line — not by throwing, to avoid burning retries on a state that will never become "send-able".

**Programmer errors** (malformed job payload, broken invariant) are thrown as plain `Error`. BullMQ retries `attempts` times, then moves the job to the failed set. The `@OnWorkerEvent('failed')` hook logs the terminal failure.

**Do not throw `DomainError` inside processors.** The HTTP-boundary semantics (e.g., `INVITATION_EXPIRED`) have no meaning in a BullMQ context; unwrap or catch-and-return instead.

## PII Handling

The processor logs only safe fields:

- **`invitationId`**: safe, used for correlation with the purchase/enrolment flow.
- **`recipientEmailDomain`**: the domain part of the email (everything after `@`); avoids logging personally identifiable information (PII) like the full email address.
- **`invitationUrl`**: **never logged**, not even as a redaction target. The plaintext token is sensitive; it is stored only in the job payload and must never appear in logs.

Pino redaction is also configured (via ADR 0005) to mask email-shaped strings at the logger level as a second barrier.

## Producer Contract (PurchasesService → Queue)

```typescript
// Inside PurchasesService.create(...)
const { purchase, invitation } = await this.purchasesRepository.transaction(async (manager) => {
    // Insert purchase, invitation, and idempotency key inside a single transaction
    const purchase = await purchaseRepo.save({ /* ... */ }, { manager });
    const invitation = await invitationRepo.save({ /* ... */ }, { manager });
    await idempotencyKeyRepo.save({ purchaseId, invitationId }, { manager });
    return { purchase, invitation };
});

// After transaction commits — DO NOT enqueue inside the transaction.
// Redis is not transactional with Postgres.
await this.invitationEmailQueue.add('invitation.email.send', {
    invitationId: invitation.invitationId,
    recipientEmail: invitation.studentEmail,
    courseTitle: course.title,
    invitationUrl: buildInvitationUrl(invitation.token),
}, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 1000 },
    jobId: `invitation-email-${invitation.invitationId}`,
});
```

**Why post-commit, not in a TypeORM `@AfterInsert` hook?** The hook fires inside the transaction. If the transaction rolls back after the hook ran, we've already enqueued a job pointing at a row that doesn't exist. Post-commit enqueue accepts a narrow "purchase succeeded but enqueue failed" gap; the design treats that gap as acceptable because the parent still has the invitation URL on screen and an admin can manually re-trigger via the Bull Board "resend" endpoint.

**Upgrade path:** transactional outbox pattern — insert an `outbox_events` row inside the transaction, a separate worker polls the table and enqueues to BullMQ. Not in scope for v1; documented in ADR 0006.

## Bull Board (Admin Dashboard)

### Endpoint

```
GET /admin/queues
```

**Auth:** Bearer JWT (ADMIN only). Unauthenticated requests and non-ADMIN roles are rejected with HTTP 403.

**Route guard:** The `@Roles(UserRoleEnum.ADMIN)` guard runs before the board middleware to ensure only admins can access job inspection.

**Auth wiring:** Bull Board auth is configured via `BullBoardModule.forRoot({ middleware: BullBoardAuthMiddleware, ... })` — the middleware runs before the route guard, not after, so it gets the chance to validate tokens before the board attempts to render.

### Features

- **Active jobs** — currently processing or waiting in queue.
- **Completed jobs** — finished successfully within the retention window (24h or 1000 most-recent).
- **Failed jobs** — retried unsuccessfully, moved to failed set within retention window (7 days or 1000 most-recent).
- **Retry UI** — click "Retry" on a failed job to move it back to the waiting queue.
- **Payload inspection** — click a job to view its full payload (including the invitation URL — access is already ADMIN-gated).

## Graceful Shutdown

```typescript
// apps/backend/src/main.ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();  // triggers OnModuleDestroy on all modules
```

When the process receives `SIGTERM` (e.g., from `docker compose stop backend`):

1. `enableShutdownHooks()` triggers NestJS module destroy lifecycle.
2. `@nestjs/bullmq` listens for module destroy and calls `worker.close()` on each registered processor.
3. `worker.close()` stops pulling new jobs from the queue.
4. In-flight `process()` calls are allowed to complete (or timeout after `lockDuration` if they stall).
5. The Redis connection is closed cleanly.

No orphaned jobs remain in-flight; the queue persists pending jobs and retries them after the worker restarts.

## Logging & Observability

Every job log line carries a `requestId` (`job:<bullmq-job-id>`) via `nestjs-cls` for correlation with the original purchase that enqueued it.

**Log structure:**
- **Processor start** — INFO level, structured log with `invitationId`, `recipientEmailDomain`.
- **Already sent** — INFO level, short-circuit, includes prior `emailSentAt` timestamp.
- **Lost race** — INFO level, indicates concurrent retry already marked the row; not an error.
- **Failure** — ERROR level, includes `jobId`, `attemptsMade`, `totalAttempts`, error message.

No full payloads are logged (would include recipient email and invitation URL, which are PII/sensitive).

## Tests

### Unit Tests

**Processor idempotency:**
- Call `processor.process(job)` twice with the same `invitationId`.
- Assert only one "[invitation.email.send] would send" log line.
- Assert `markEmailSent` is called exactly once (mocked).

**Processor retry behavior:**
- Mock `invitationsRepository.markEmailSent` to throw a transient error.
- Assert the processor rethrows so BullMQ schedules a retry.
- Assert `job.attemptsMade` increments via mock inspection.

**Lost race detection:**
- Mock `markEmailSent` to return `affected: 0` (another retry won the race).
- Assert the processor logs `INVITATION_EMAIL_SEND_LOST_RACE` at info level and returns success.

### Integration Tests

**Full happy path:**
- `POST /purchases` (parent completes purchase).
- Wait for the job to be picked up by the processor (poll the queue or sleep).
- Assert the invitation `email_sent_at` column is set in the database.
- Assert the "[invitation.email.send]" log line appears in stdout.

## What's Deferred (Carry-overs to M10+)

- **Email template rendering** — v1 logs to stdout only; real SMTP integration deferred to M10.
- **Transactional outbox** — post-commit gap is documented; outbox pattern upgrade in M09+.
- **Custom backoff strategies** — exponential is sufficient for v1; adaptive backoff based on failure patterns deferred.
- **Queue-level filtering or rerouting** — all jobs go to the single `INVITATION_EMAIL_QUEUE`; message-type routing deferred.
- **Scheduled jobs** — BullMQ supports repeating jobs; not used in v1.

## See also

- [Architecture overview](../architecture/overview.md)
- [Async jobs architecture](../architecture/async-jobs.md)
- [ADR 0004 — BullMQ for async](../architecture/adr/0004-bullmq-for-async.md)
- [ADR 0005 — Logging and error handling](../architecture/adr/0005-logging-and-error-handling.md) — correlation ID propagation
- [ADR 0006 — Retries and idempotency](../architecture/adr/0006-retries-and-idempotency.md)
- [Data model](../architecture/data-model.md) — `invitations.email_sent_at`
- [Code conventions](../best-practices/code-conventions.md)
