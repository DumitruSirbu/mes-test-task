# ADR 0004 — BullMQ for Async Work

> Status: draft. Finalised in M02 by `mes-architect`.

## Context

The purchase flow should not block on email "delivery". A retry-safe async pipeline is a real engineering signal even when the actual send is mocked.

## Decision

Redis-backed BullMQ. One queue per concern (`INVITATION_EMAIL_QUEUE` for v1). Processor extends `WorkerHost`, configured with retries, backoff, dead-letter retention, and a graceful shutdown hook.

## Consequences

- ✅ Real retry policy, real idempotency, real failure inspection.
- ✅ Bonus: mountable Bull Board for admin queue visibility.
- ⚠️ Adds Redis to the stack — justified since it's also the natural cache substrate.

## Alternatives considered

- **`@nestjs/schedule` (cron).** Sufficient for periodic work; not for unit-of-work retries.
- **In-process EventEmitter.** No durability across restarts; loses work on crash.
- **Postgres-based queue (e.g., `pg-boss`).** Avoids Redis but is less idiomatic in the NestJS ecosystem and has fewer dashboards.
