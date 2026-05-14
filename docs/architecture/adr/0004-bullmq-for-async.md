# ADR 0004 — BullMQ for Async Work

- **Status:** Accepted (2026-05-13) · **Amended by [ADR 0007](./0007-refresh-token-rotation.md)** (2026-05-14)
- **Deciders:** mes-architect, mes-orchestrator
- **Tags:** async, queues, retries

> **Amendment (2026-05-14) — `maintenance` queue category.** [ADR 0007 §10](./0007-refresh-token-rotation.md) introduces a new queue category to the inventory:
>
> > **`maintenance`** — periodic-sweep queue for housekeeping jobs that don't belong to a domain workflow. Naming convention: `<domain>-cleanup` (e.g. `refresh-token-cleanup`). Jobs are BullMQ **repeatable** (cron-style); schedules are declared on the processor. Failure alerting via `logger.error` with a stable `code:` field — there is no metrics pipeline today (see ADR 0005 amendment). First inhabitant: `refresh-token-cleanup` (M09). Future inhabitants: idempotency-key sweep (per ADR 0006's "Next steps"), expired-invitation cleanup, etc. — **all live here, not in domain queues**, so the next milestone that needs a periodic sweep inherits the pattern instead of reinventing it.
>
> All retry / dedup / shutdown rules from the original body apply to maintenance jobs. The lifecycle expectation differs only in that maintenance jobs are produced by the scheduler (`repeat: { pattern: '0 3 * * *' }`), not by an HTTP handler.

## Context

The purchase flow produces a side effect — "send the invitation email to the student" — that should not block the HTTP response and must survive transient failures (mocked SMTP, real provider outage in v2). Doing this synchronously in the request would:

- Block the user on someone else's SLA.
- Couple purchase success to email-provider availability.
- Hide retry semantics in ad-hoc try/catch loops.

Even when the actual "send" is just a `logger.log(...)`, the engineering signal is real: the codebase should demonstrate a defensible async pipeline with retries, idempotency, and graceful shutdown.

## Decision

Use **Redis-backed BullMQ** via `@nestjs/bullmq`. One queue per concern. The v1 queue is `INVITATION_EMAIL_QUEUE` carrying `invitation.email.send` jobs. Processors extend `WorkerHost` and run inside the same Nest process as the API for v1 (split is one config change away — see ADR 0001).

Configuration baseline (full details in `async-jobs.md`):

- `attempts: 5`, exponential backoff `delay: 2_000`, capped at 60s.
- `removeOnComplete: { age: 86_400, count: 1_000 }`, `removeOnFail: false`.
- `jobId: \`invitation-email-${invitationId}\`` for queue-level dedup.
- Processor-level idempotency via `invitations.email_sent_at IS NULL` check.
- Graceful shutdown via `app.enableShutdownHooks()` → `worker.close()`.

## Consequences

**Positive:**

- Real retry policy: a failing "send" retries on a real schedule, not "on the next request".
- Real idempotency: three layers (queue dedup, processor check, DB conditional update) all defensible to a reviewer.
- Real failure inspection: `removeOnFail: false` keeps failed jobs visible; bonus Bull Board mount surfaces them in the admin panel.
- Redis is already in the stack; no new infra cost.
- Workers and producers share the same module wiring — adding a second queue tomorrow is one constant + one processor.

**Negative / acknowledged trade-offs:**

- Adds Redis as a hard dependency. Acceptable: Redis was always going to be in the stack as the natural cache + queue substrate for any non-trivial Node project, and the M01 `docker-compose.yml` already brings it up.
- The enqueue happens **after** the Postgres transaction commits — Redis is not transactional with Postgres, so there is a narrow window where the purchase commits but the enqueue fails. M04 accepts this gap; the upgrade path (transactional outbox) is recorded in ADR 0006.
- BullMQ requires `IORedis` with `maxRetriesPerRequest: null` — easy to miss; documented in `async-jobs.md`.

## Alternatives considered

### `@nestjs/schedule` (cron / timers)

Good for periodic work ("nightly sweep"). Bad fit for unit-of-work retries with per-job state. Rejected for this concern; may be useful later for invitation-expiry sweeps.

### In-process EventEmitter

`@nestjs/event-emitter` or a hand-rolled emitter. Zero infra cost. Rejected because:

- No durability — a crash between purchase commit and email "send" drops the event silently.
- No retry semantics.
- No visibility into failed jobs.

### Postgres-backed queue (`pg-boss`)

Avoids Redis. Genuinely attractive when you already have Postgres and want one fewer service. Rejected because:

- Less idiomatic in NestJS — `@nestjs/bullmq` is the well-trodden path.
- Fewer dashboards / inspection tools.
- BullMQ's payload model + retry/backoff semantics are more battle-tested.
- Redis is already in the stack for v2 cache use.

### Kafka / RabbitMQ / SQS

All viable at scale. All wildly out of scope for a 3–4 hour deliverable single-service demo.

## Open questions / deferred

- **Outbox pattern** for guaranteed event delivery if the post-commit enqueue ever drops jobs — see ADR 0006.
- **Worker process split** — defer until the worker's CPU/memory profile diverges from the API's.
- **Bull Board** mount under `/admin/queues` — implement in M08 if budget permits.

## See also

- [../async-jobs.md](../async-jobs.md)
- [0001-modular-monolith.md](./0001-modular-monolith.md) — worker co-located with API for v1
- [0006-retries-and-idempotency.md](./0006-retries-and-idempotency.md)
