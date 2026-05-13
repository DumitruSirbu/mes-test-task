# Async Jobs (BullMQ)

> **Status:** finalised in M02 by `mes-architect`. Implementation lands in M08. Reviewed by `mes-review-logic`.

This doc defines the queue inventory, BullMQ wiring, the v1 job (`invitation.email.send`), retry and idempotency rules, and the producer / consumer contract. ADR 0004 holds the rationale for choosing BullMQ at all; ADR 0006 holds the broader retry & idempotency policy.

## Queue inventory

| Queue constant | Job name(s) | Purpose | Producer | Consumer |
|---|---|---|---|---|
| `INVITATION_EMAIL_QUEUE` | `invitation.email.send` | "Send" the invitation email (logs the rendered email to stdout in v1) | `PurchasesService` (after the purchase + invitation transaction commits) | `InvitationEmailProcessor` |

> **One queue per concern.** Future concerns get a new constant + a new queue. We do not multiplex unrelated job types onto the same queue — it complicates retention, concurrency, and dashboards for no gain.

## BullMQ connection wiring

```ts
// apps/backend/src/notifications/notifications.module.ts
@Module({
    imports: [
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                connection: {
                    host: configService.getOrThrow<string>('REDIS_HOST'),
                    port: configService.getOrThrow<number>('REDIS_PORT'),
                    // BullMQ requires maxRetriesPerRequest: null on the IORedis client
                    maxRetriesPerRequest: null,
                },
            }),
        }),
        BullModule.registerQueue({ name: INVITATION_EMAIL_QUEUE }),
    ],
    providers: [InvitationEmailProcessor],
})
export class NotificationsModule {}
```

The connection is shared across queues (BullMQ docs recommend distinct IORedis instances for `Queue` and `Worker` — `@nestjs/bullmq` handles that for us when you register through `BullModule`).

## Job: `invitation.email.send`

### Payload

```ts
// packages/shared/src/types/IInvitationEmailJob.ts
export interface IInvitationEmailJob {
    invitationId: number;
    recipientEmail: string;
    courseTitle: string;
    invitationUrl: string;
}
```

The payload carries everything the processor needs without an extra DB read in the happy path. The processor still loads the `invitation` row to perform the idempotency check.

### Job options (set at enqueue time)

```ts
queue.add('invitation.email.send', payload, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },     // 2s, 4s, 8s, 16s, 32s (capped at 60s)
    removeOnComplete: { age: 86_400, count: 1_000 },     // 24h / 1000 most-recent
    removeOnFail: false,                                 // keep failed jobs for inspection
    jobId: `invitation-email-${payload.invitationId}`,   // dedupe at the queue level
});
```

The `jobId` deduplication means a parent who somehow triggers two enqueues for the same invitation only gets one queued job — BullMQ rejects the second `add` with the same id. This is the **queue-level** idempotency layer; the **processor-level** layer is the `email_sent_at` check (below).

### Backoff cap

BullMQ doesn't natively cap exponential delay. We implement the cap by computing `Math.min(2_000 * 2 ** attemptsMade, 60_000)` inside a custom `backoff: { type: 'custom' }` strategy if the default exponential overshoots the cap before `attempts: 5` exhausts. With `attempts: 5` and `delay: 2_000`, the natural sequence (2, 4, 8, 16, 32 seconds) stays under 60s anyway, so the default exponential strategy is acceptable for v1.

### Processor

```ts
// apps/backend/src/notifications/processor/InvitationEmailProcessor.ts
@Processor(INVITATION_EMAIL_QUEUE, {
    concurrency: 2,
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
})
export class InvitationEmailProcessor extends WorkerHost {
    private readonly logger = new Logger(InvitationEmailProcessor.name);

    constructor(
        private readonly invitationsRepository: InvitationsRepository,
        private readonly cls: ClsService,
    ) { super(); }

    async process(job: Job<IInvitationEmailJob>): Promise<void> {
        this.cls.set('requestId', `job:${job.id}`);

        const invitation = await this.invitationsRepository.findById(job.data.invitationId);
        if (!invitation) {
            this.logger.warn(`Invitation ${job.data.invitationId} not found — dropping job`);
            return;
        }
        if (invitation.emailSentAt) {
            this.logger.log(`Invitation ${invitation.invitationId} already sent at ${invitation.emailSentAt.toISOString()} — skipping`);
            return;
        }

        // Log only safe fields. `recipientEmail` and `invitationUrl` are both redaction targets
        // (see ADR 0005). The processor logs the invitation id and the recipient email's domain
        // (everything after the `@`); the plaintext token MUST NOT reach the log in any form.
        const recipientEmailDomain = job.data.recipientEmail.split('@')[1] ?? 'unknown';
        this.logger.log({ invitationId: invitation.invitationId, recipientEmailDomain }, '[invitation.email.send] would send');
        await this.invitationsRepository.markEmailSent(invitation.invitationId, new Date());
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error) {
        this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
    }
}
```

### Errors inside processors

The `DomainError` hierarchy from ADR 0005 is an **HTTP-boundary** concern — it exists so the global `HttpExceptionFilter` can render a canonical JSON response. BullMQ has no HTTP boundary; it has a retry boundary. Inside a processor:

- **Transient infrastructure failures** (mailer SMTP timeout, Redis blip on the inner `markEmailSent` write, transient DB error) are thrown as plain `Error` subclasses (e.g. a hypothetical `MailerTransientError extends Error` wrapping the underlying `cause`). BullMQ catches the throw and schedules the next retry per the `attempts` / `backoff` config. We do **not** throw `DomainError` from processors — `httpStatus` has no meaning here, and an HTTP `code` like `INVITATION_EXPIRED` would be misleading in the job log.
- **Logical no-ops** (invitation already sent, invitation deleted) are handled with early `return` and a structured log line — not by throwing. Throwing here would burn retries on a state that will never become "send-able".
- **Programmer errors** (bad job payload, broken invariant) are thrown as plain `Error`. BullMQ retries `attempts` times, then moves the job to the failed set; the `OnWorkerEvent('failed')` hook logs it. The operator inspects via Bull Board.

Rule of thumb: if a service called from inside the processor itself throws a `DomainError` (because that service is also used by an HTTP controller), the processor should either treat it as a logical no-op (catch and `return`) or unwrap it to a plain `Error` before rethrowing — never re-raise a `DomainError` for BullMQ to retry on. The HTTP semantics travel through the filter, not through the queue.

Three idempotency layers stacked:

1. **Queue-level** (`jobId` dedup) prevents duplicate enqueues.
2. **Processor-level** (`email_sent_at IS NULL` check) prevents duplicate sends on retry of a transient failure.
3. **DB-level** (`UPDATE ... WHERE email_sent_at IS NULL`) makes the `markEmailSent` write itself idempotent under concurrent retries.

## Producer contract (PurchasesService → queue)

```ts
// Inside PurchasesService.create(...)
// Doc-level simplification: real implementation uses BaseRepository.transaction(...)
// (which wraps DataSource internally per code-conventions.md). Services do NOT inject
// DataSource directly — they go through the repository's transaction helper.
const { purchase, invitation } = await this.purchasesRepository.transaction(async (manager) => {
    /* ... insert purchase, insert invitation, insert idempotency_key via manager-bound repos ... */
    return { purchase, invitation };
});

// After commit — Redis is not transactional with Postgres
await this.invitationEmailQueue.add('invitation.email.send', {
    invitationId: invitation.invitationId,
    recipientEmail: invitation.studentEmail,
    courseTitle: course.title,
    invitationUrl: buildInvitationUrl(invitation.token),
}, /* opts above */);
```

**Why enqueue after commit and not in a TypeORM `@AfterInsert` hook:** the hook fires inside the transaction. If the transaction rolls back after the hook ran, we've already enqueued a job pointing at a row that doesn't exist. Post-commit enqueue accepts a narrow "purchase succeeded but enqueue failed" gap; M04's design treats that gap as acceptable because the parent still has the invitation URL on screen and the admin can re-trigger.

**Upgrade path:** transactional outbox pattern — insert an `outbox_events` row inside the transaction, a separate worker polls the table and enqueues to BullMQ, marking sent. Not in scope for v1; flagged in ADR 0006.

## Admin resend flow (`POST /admin/invitations/:id/resend`)

Locked semantics — the handler runs **both** of the following as a single atomic flow, in order:

1. **Clear the processor-level idempotency marker.** `UPDATE invitations SET email_sent_at = NULL WHERE invitation_id = $id` (and re-validate the row is still `ISSUED` and not expired). Without this, the processor's `if (invitation.emailSentAt) return` short-circuit will skip the resend immediately.
2. **Reset the queue-level dedup, then re-enqueue.** Call `queue.remove(\`invitation-email-${invitationId}\`)` to drop any prior job record holding the deterministic `jobId`, then `queue.add('invitation.email.send', payload, { jobId: \`invitation-email-${invitationId}\`, ...standardOpts })`. Without the `remove`, BullMQ would reject the second `add` with the same `jobId`.

Both steps are required. Doing only (1) leaves the queue refusing the new job; doing only (2) leaves the processor skipping it. The handler performs them in this order so that an in-flight retry of the old job (rare) cannot win the race and re-mark `email_sent_at` between (1) and (2) — the queue-level removal in (2) terminates any still-pending old job record before the new one is added.

Cross-referenced from the role matrix in `auth-and-rbac.md` (footnote on `POST /admin/invitations/:id/resend`).

## Graceful shutdown

```ts
// apps/backend/src/main.ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();   // triggers OnModuleDestroy on workers — BullMQ closes connections cleanly
```

`@nestjs/bullmq` listens for module destroy events and calls `worker.close()` internally, which:
- stops pulling new jobs,
- waits for in-flight `process()` calls to finish,
- closes the Redis connection.

Verified by `docker compose stop backend` (M08 DoD) — the SIGTERM should drain without orphaning in-flight jobs.

## Optional: Bull Board

`@bull-board/express` + `@bull-board/nestjs` mounted at `GET /admin/queues`, guarded by `@Roles(UserRoleEnum.ADMIN)`. Provides UI for inspecting failed jobs, retrying, and viewing payloads. Bonus signal — implementable in M08 if budget allows.

## Observability

- Every job log line carries a `requestId` (`job:<bullmq-job-id>`) via `nestjs-cls` (ADR 0005). The `PurchasesService` that enqueued the job is also identifiable from the BullMQ job timestamp + the invitation FK.
- `@OnWorkerEvent('completed' | 'failed' | 'stalled')` hooks emit a single log line per terminal event; the `failed` line includes attempt number + error message but **not** the full payload (could contain `recipientEmail` — partially redacted by pino).

## Test plan (M08)

- **Unit**: call `processor.process(job)` twice with the same `invitationId`; assert only one "would send" log and `markEmailSent` only called once (because of the second-attempt skip branch).
- **Unit**: make `markEmailSent` throw; assert the processor rethrows so BullMQ schedules a retry; assert `attemptsMade` increments via mock.
- **Integration**: full happy path — `POST /purchases` → wait for job → assert log + DB column set. Run against the Docker stack with testcontainers or the real compose Redis.

## See also

- [adr/0004-bullmq-for-async.md](./adr/0004-bullmq-for-async.md)
- [adr/0005-logging-and-error-handling.md](./adr/0005-logging-and-error-handling.md) — correlation ID propagation
- [adr/0006-retries-and-idempotency.md](./adr/0006-retries-and-idempotency.md) — the broader policy
- [data-model.md](./data-model.md) — `invitations.email_sent_at`
- [../best-practices/code-conventions.md](../best-practices/code-conventions.md) — processor patterns
