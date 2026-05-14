# ADR 0006 — Retries & Idempotency

- **Status:** Accepted (2026-05-13) · **Amended by [ADR 0007](./0007-refresh-token-rotation.md)** (2026-05-14)
- **Deciders:** mes-architect, mes-orchestrator; reviewed by `mes-review-logic`
- **Tags:** reliability, idempotency, retries

> **Amendment (2026-05-14) — frontend 401 retry rule.** [ADR 0007](./0007-refresh-token-rotation.md) supersedes the original "no retry on 401" rule in §3 (Frontend HTTP). The new behaviour:
>
> > On `AUTH_TOKEN_EXPIRED` (401) — attempt one silent refresh; on success, retry the original request **exactly once**. **The retried request bypasses the 401 handler entirely** — any 401 on the retry (regardless of error code) drops the token and redirects to `/login`, never re-enters the refresh path. On `AUTH_INVALID_TOKEN`, `AUTH_FORBIDDEN_ROLE`, or refresh failure → drop token, redirect to `/login`. **Never retry on any other 4xx.** This guarantees no recursion under clock skew or pathological backend states.
>
> The original "no retry on 401" line in §3 below should be read in light of this amendment. All other rules in this ADR are unchanged.

## Context

Three retry surfaces exist in this system and they need **different** policies:

1. **BullMQ async jobs** — transient infra failure should retry; logical failure should not.
2. **Mock payment / purchase** — the user submits once; the network may double-deliver.
3. **Frontend HTTP** — TanStack Query can retry queries on flake; mutations must not double-write.

A single "retry on failure" policy applied uniformly would either retry too little (lost jobs) or too much (double-purchase, double-email). Each surface gets its own rule.

## Decision

### 1. BullMQ jobs

- `attempts: 5`, `backoff: { type: 'exponential', delay: 2_000 }`, naturally capped at ~32s on the last attempt; an explicit `Math.min(..., 60_000)` cap is applied via a custom backoff strategy if delay exceeds 60s.
- `removeOnFail: false` — failed jobs are retained for inspection (via Bull Board or DB-level checks).
- **Queue-level dedup** via deterministic `jobId` (`invitation-email-<invitationId>`). BullMQ rejects duplicate `add` calls with the same `jobId`.
- **Processor-level idempotency** via business-state check: the `InvitationEmailProcessor` short-circuits if `invitations.email_sent_at IS NOT NULL`.
- **DB-level idempotency** via conditional update: `UPDATE invitations SET email_sent_at = $now WHERE invitation_id = $id AND email_sent_at IS NULL`.
- Graceful shutdown: `app.enableShutdownHooks()` triggers `worker.close()` on `SIGTERM`; in-flight `process()` calls drain before exit.
- **Processor error policy** (cross-ref `async-jobs.md` "Errors inside processors"): plain `Error` subclasses (e.g. `MailerTransientError`) are thrown for transient categories (network, Redis, transient DB) and BullMQ retries them. Logical no-ops (invitation missing, already sent) log + return rather than throw — no point burning retries on a state that will never become send-able. `DomainError` subclasses are **not** thrown from processors; they belong to the HTTP boundary (ADR 0005), not the queue boundary.

### 2. Purchase / mock payment

- Client generates a **UUID `Idempotency-Key`** on the checkout-page load and sends it as a header on `POST /purchases`. The interceptor validates the key (length 8–64, charset `[A-Za-z0-9_-]`) and rejects malformed keys with `IDEMPOTENCY_KEY_REQUIRED` (400) before any DB read.
- Backend `IdempotencyInterceptor` (in `common/idempotency/`) intercepts POSTs marked with the `@Idempotent()` decorator:
  - Canonicalises the request body per **RFC 8785 (JCS — JSON Canonicalization Scheme)** before hashing — this ensures key order, whitespace, and number formatting cannot trip the equality check. `request_hash` = `SHA-256(JCS(body))`.
  - Looks up `(user_id, endpoint, key)` in `idempotency_keys`.
  - **Hit, matching `request_hash`, stored `response_body` populated** → return stored `response_status` + `response_body` verbatim. Log `code: IDEMPOTENCY_REPLAY` at info level.
  - **Hit, matching `request_hash`, stored `response_body` still NULL (original request in-flight)** → 409 with `code: IDEMPOTENCY_KEY_REUSED`. Body matches, but the canonical response has not yet been written. Client SHOULD retry after a short delay (the original request is still running).
  - **Hit, different `request_hash`** → 409 with `code: IDEMPOTENCY_BODY_MISMATCH`. Permanent client error — the same key was reused with a different payload. Client MUST NOT retry with this key; fix the bug and pick a new key.

  The two 409 codes are **disjoint**: `IDEMPOTENCY_KEY_REUSED` means "same key, same body, retry shortly" and `IDEMPOTENCY_BODY_MISMATCH` means "same key, different body, do not retry". Each canonical error code maps to exactly one `DomainError` subclass; neither is an alias of the other.
  - **Miss** → run the handler; if it succeeds (2xx), persist `(key, user_id, endpoint, request_hash, response_status, response_body)` inside the same transaction as the business write.
  - **UNIQUE-violation race**: if two concurrent calls both pass the SELECT and try to INSERT, Postgres raises `23505` on `IDX_idempotency_keys_user_endpoint_key_unique` (and as a secondary safety net on `IDX_purchases_parent_idemkey_unique`). The interceptor catches the `QueryFailedError`, re-reads the stored row, and returns the canonical replay response. The raw error never surfaces as a 500.
- **`response_body` shape (purchase endpoint):** stored body is **`{ purchaseId, invitationId }` only** — NOT the invitation URL, NOT the token, NOT the email. A replaying client re-fetches details via `GET /me/purchases/:id`. Rationale: a stolen DB dump must not yield live invitation links, and the response body is not the right place to re-serve a token that was meant to live only in an email.
- **Per-table denormalised UNIQUE** on `purchases.idempotency_key` (scoped to `parent_user_id`) acts as a secondary safety net independent of the central `idempotency_keys` table. Documented in `data-model.md`; both indices are caught by the same UNIQUE-violation translation above.
- **Purchase + invitation issuance is a single TypeORM transaction.** Either both rows land or neither does. No partial state to retry from.
- **No server-side automatic retry against the mock PSP.** Real payment providers are stateful; a blind server-side retry risks double-charges. The mock PSP "succeeds" synchronously, so retries are unnecessary anyway.
- **Frontend explicitly disables retry on the purchase mutation:** `useMutation({ mutationFn: ..., retry: false })`. The button is disabled while the request is in flight to prevent the user double-clicking.

### 3. Frontend HTTP (TanStack Query)

- **Queries** (`useQuery`): `retry: 2`, exponential backoff (TanStack default). **Skip retry on 4xx** — a 404 or 401 will not become a 200 by trying again. Configured via a custom `retry` function inspecting the parsed `ApiError.status`.
- **Mutations** (`useMutation`): `retry: 0` by default. Opt-in `retry: 2` only on endpoints we know are idempotent (e.g., `GET`-like POSTs, none in v1).
- **401 `AUTH_TOKEN_EXPIRED`**: drop the token, redirect to `/login`, **no retry**. Avoids a retry loop hammering `/auth/me` with a dead token.
- Configured once in the root `QueryClient`; not per-call.

## Consequences

**Positive:**

- The system is safe under realistic failure modes: network jitter, request replays, redis hiccups, page reloads mid-checkout.
- No double-purchase, no double-email, no double-state.
- Idempotency is scoped per user (`UNIQUE (user_id, endpoint, key)`), preventing cross-tenant key collisions.
- Frontend behaviour matches user intent: queries auto-recover; mutations don't fire twice.

**Negative / acknowledged trade-offs:**

- **Post-commit enqueue gap.** The transaction commits before `queue.add(...)`. If the process crashes between commit and enqueue, the purchase exists but the email job does not. Acceptable at this scope (the parent has the invitation URL on screen; an admin can re-trigger). Upgrade path = transactional outbox (see below).
- **Idempotency key reuse with a different body returns 409**, which is a learning curve for clients but is correct — it's the only way to catch a client bug where the key is bound to the wrong payload.
- **No DB serialization-failure retry wrapper** for `40001` errors. At this concurrency level it's unnecessary; flagged as a future smell if contention rises.
- **`idempotency_keys` retention**: a 24-hour sweep job is on the README "Next steps". In v1 the table grows indefinitely — acceptable for a demo.
- **Missing `Idempotency-Key` header** on `POST /purchases` → 400 `IDEMPOTENCY_KEY_REQUIRED`. The frontend always provides one.

## Alternatives considered

### Transactional outbox

Insert an `outbox_events` row inside the purchase transaction; a separate worker polls the table and enqueues to BullMQ, marking sent. Closes the post-commit gap. Adds: a new table, a poller, a duplicate-send check on the consumer (already in place). **Not in scope for v1** — recorded as the upgrade path.

### Circuit breaker / bulkhead

Only valuable when calling flaky third parties — none in v1. Reconsider when the real payment provider lands.

### Server-side retry against the mock PSP

Rejected — real PSPs are stateful and retrying server-side risks double-charges.

### Storing idempotency keys in Redis instead of Postgres

Faster lookups, but loses the transactional coupling with the business write. Rejected — the whole point is that the key + response + business row commit atomically.

### Aggressive frontend mutation retries

Rejected for non-idempotent mutations. Frontend retry of a `POST /purchases` after a flaky network looks identical to a malicious double-click; the only safe answer is "no retry, and the server's idempotency layer handles the duplicate".

## See also

- [../async-jobs.md](../async-jobs.md) — processor idempotency layers
- [../data-model.md](../data-model.md) — `idempotency_keys` schema
- [0004-bullmq-for-async.md](./0004-bullmq-for-async.md)
- [0005-logging-and-error-handling.md](./0005-logging-and-error-handling.md) — canonical error shape
