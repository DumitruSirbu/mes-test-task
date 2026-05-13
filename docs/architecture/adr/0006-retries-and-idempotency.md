# ADR 0006 — Retries & Idempotency

> Status: draft. Finalised in M02 by `mes-architect`.

## Context

Three retry surfaces exist: async jobs, payment/purchase, frontend HTTP. Each needs a different policy.

## Decision

**BullMQ jobs:**
- `attempts: 5`, `{ type: 'exponential', delay: 2000 }` capped at 60s.
- Idempotency on the processor (`email_sent_at` check).
- `removeOnFail: false` — failed jobs retained for inspection.
- Graceful shutdown via `worker.close()` on `SIGTERM`.

**Purchase / mock payment:**
- Client sends `Idempotency-Key` header (UUID) on `POST /purchases`.
- Backend stores `(idempotency_key UNIQUE, user_id, response_body jsonb)`. A retry with the same key returns the original `response_body`. Same key + different body → 409.
- No server-side automatic retry against the mock PSP. Real PSPs are stateful; retrying server-side risks double-charges.
- Frontend: purchase mutation explicitly `retry: false`.
- Purchase + invitation issuance is a single TypeORM transaction. Either both land or neither does. No partial states to retry from.

**Frontend HTTP:**
- Queries: `retry: 2` exponential, **skip on 4xx**.
- Mutations: `retry: 0` by default. Opt-in per idempotent endpoint.
- 401 → single refresh attempt; if fail, logout. No retry loop on auth.

## Consequences

- ✅ Safe under network jitter and partial failures.
- ✅ No double-purchase, no double-email, no double-state.

## Alternatives considered

- **Outbox pattern** for guaranteed event delivery — the upgrade path if the in-process enqueue ever drops jobs. Not needed at this scope.
- **Circuit breaker / bulkhead.** Only justified when calling flaky third parties — none in scope.
- **DB transient-error retry wrapper** for `40001` serialization failures — only matters under contention.
