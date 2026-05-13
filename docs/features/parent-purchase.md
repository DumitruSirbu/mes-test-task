# Parent Purchase & Invitation (M04)

> **Status:** shipped in M04. Covers the parent journey from catalog browse through to invitation URL.

## Goal

A parent can browse the course catalog, pick a Year-N subject, complete a mock checkout, and walk away with an invitation URL to share with the student. The flow is end-to-end idempotent and transactional.

## Surface

### Backend

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/courses` | Public | Lists the seeded catalog (~25 rows) — subject, year range, title, price in pence. |
| GET | `/courses/:id` | Public | Detail view for a single course. |
| POST | `/purchases` | PARENT (Bearer JWT) | Atomic purchase + invitation issuance. Requires `Idempotency-Key`. |
| GET | `/me/purchases` | PARENT | Parent's own purchase history (newest first). |

### Frontend (`apps/web`)

Hash-based SPA routes (no third-party router added):

| Route | Purpose |
|---|---|
| `#/courses` | Catalog listing — public. |
| `#/courses/:id` | Detail view + "Buy access for a student" CTA. |
| `#/checkout/:courseId` | Form (student email) — generates a UUID `Idempotency-Key` on mount, submits with `retry: false` semantics (button disabled while in flight). |
| `#/checkout/success` | Shows the invitation URL with a copy-to-clipboard button. |
| `#/login`, `#/signup` | Minimal parent auth flow added so the journey is exercisable end-to-end. |

The auth store is `localStorage`-backed; the route view checks `auth.role === UserRoleEnum.PARENT` before letting the parent into checkout.

## Pre-transaction duplicate-purchase check

Before opening the transaction, `POST /purchases` runs a parent-scoped duplicate check:
- Query `purchases` JOIN `invitations` for `(parent_user_id = caller, course_id = body.courseId, status = COMPLETED, invitation.student_email = body.studentEmail)`.
- If a row exists, return **HTTP 409 `PURCHASE_ALREADY_EXISTS_FOR_STUDENT`** immediately. No purchase row, no invitation, no email is created.

Scope rationale: the check is restricted to the **calling parent's own purchases** so the endpoint does not act as a `(studentEmail, courseId)` enrolment-existence oracle for other accounts. Cross-parent duplicates are still caught at invitation redemption time by the unique index on `enrolments(student_user_id, course_id)` (ADR 0006) — the precheck is best-effort UX, not the strict invariant.

The frontend catches the 409, navigates back to the course detail page, and displays a one-shot flash message: "{studentEmail} is already enrolled in this course."

## Atomic write (ADR 0006)

`POST /purchases` runs three INSERTs inside a single TypeORM transaction (only after the duplicate-purchase precheck succeeds):

1. `purchases` — status `COMPLETED`, `amount_pence` snapshot of the course price at purchase time, denormalised `idempotency_key`.
2. `invitations` — `token_hash = SHA-256(plaintextToken)`, `status = ISSUED`, `expires_at = now + 14 days`. The plaintext token escapes the service only in the create response.
3. `idempotency_keys` — minimal `{ purchaseId, invitationId }` body. The plaintext URL is **never** stored — a DB dump must not yield live invitation links.

If any of the three INSERTs fails the transaction rolls back; there is no half-purchase to retry from. The course lookup runs before the transaction opens so a missing course returns 404 fast without a wasted BEGIN/ROLLBACK round-trip.

## Idempotency protocol (ADR 0006)

- The `Idempotency-Key` header is **required** on `POST /purchases`. Format: `[A-Za-z0-9_-]{8,64}`. Validation runs in `IdempotencyInterceptor` BEFORE any DB read; malformed / missing keys return 400 `IDEMPOTENCY_KEY_REQUIRED`.
- The interceptor canonicalises the request body (key-sorted JSON; JCS-light), SHA-256-hashes it, and looks up `(user_id, endpoint, key)` in `idempotency_keys`.
- **Hit, body hash matches** → replay the stored `response_status` + `response_body` (the minimal `{ purchaseId, invitationId }` shape) and short-circuit the handler. Logged at info as `IDEMPOTENCY_REPLAY`.
- **Hit, body hash differs** → 409 `IDEMPOTENCY_BODY_MISMATCH`. Client must pick a new key; do not retry.
- **Miss** → handler runs; the service persists the row inside its own transaction. UNIQUE-violation races are translated:
  - body matches → `IDEMPOTENCY_KEY_REUSED` (409, retry shortly while the first transaction commits).
  - body differs → `IDEMPOTENCY_BODY_MISMATCH` (409).

The raw `QueryFailedError` is never surfaced as a 500; it is attached to the wrapping `DomainError` as `cause` for log correlation.

## Frontend checkout flow (duplicate-purchase precheck)

When a parent submits the checkout form with a student email:

1. **`CheckoutPage` sends:** `POST /purchases` with `courseId` and `studentEmail` (+ `Idempotency-Key`).
2. **Backend responds 201:** Happy path — parent is shown the invitation URL with copy-to-clipboard.
3. **Backend responds 409 `PURCHASE_ALREADY_EXISTS_FOR_STUDENT`:**
   - `CheckoutPage` catches the error and writes a one-shot `mes.checkoutFlash.v1` entry to `sessionStorage` carrying `{ kind: 'already-enrolled', studentEmail, courseId }`.
   - Navigates to `#/courses/:id` (the course detail page).
   - `CourseDetailPage` reads the flash on mount; if `flash.courseId` matches the current route param, it consumes (removes) the entry and renders: "{studentEmail} is already enrolled in this course." Otherwise the entry is left untouched so the right page can consume it.
   - Malformed entries are discarded silently.

Shared constants for the storage key, the flash discriminant, and the backend error code live in `apps/web/src/util/checkoutFlash.ts` so writer (`CheckoutPage`) and reader (`CourseDetailPage`) cannot drift.

## RBAC

- `POST /purchases` and `GET /me/purchases` are class-level `@Roles(UserRoleEnum.PARENT)` on `PurchasesController`. A STUDENT or ADMIN token returns 403 `AUTH_FORBIDDEN_ROLE` from `RolesGuard`.
- The catalog endpoints are `@Public()` — anonymous browsers see the same list a logged-in parent sees.

## Token security

- Generated as `crypto.randomBytes(32)` → 256 bits of entropy, base64url-encoded.
- Stored as `SHA-256(token)` hex in `invitations.token_hash` (constant-time `WHERE token_hash = $1` lookup at redeem in M05).
- The plaintext token escapes the system only on the immediate `POST /purchases` response and is rendered into the success page via `sessionStorage`. It is never persisted on the server in plaintext, never logged.

## Migrations

| Order | File | Adds |
|---|---|---|
| 3 | `20260513150000-CreateCoursesTable.ts` | `course_subject` ENUM + `courses` table + UNIQUE `(subject, year_from, year_to)` + seed of 25 courses (Maths Y5–Y13, English Y5–Y13, Science Y5–Y11) at £199 (`19900` pence) each. |
| 4 | `20260513150100-CreatePurchasesTable.ts` | `purchase_status` ENUM (single value `COMPLETED` for v1) + `purchases` table + FKs to `users` (RESTRICT) and `courses` (RESTRICT) + the three index conventions (parent, status, `(parent, idempotency_key)` UNIQUE). |
| 5 | `20260513150200-CreateInvitationsTable.ts` | `invitation_status` ENUM (all three values) + `invitations` table + FK to `purchases` (CASCADE) + UNIQUE on `token_hash` + `email_sent_at` column (populated by the M08 BullMQ processor). |
| 6 | `20260513150300-CreateIdempotencyKeysTable.ts` | `idempotency_keys` table + UNIQUE `(user_id, endpoint, key)`. No FK on `user_id` (audit retention). |

## What's deferred (carry-overs)

- **24h retention sweep** for `idempotency_keys` — documented in ADR 0006; landing as a small BullMQ job in a future milestone.
- **Backend `GET /me/purchases` invitation URL** — listing returns `url: ''`. The plaintext token cannot be regenerated from the DB hash; an admin "resend invitation" endpoint (M07) will be the proper way to re-deliver.
- **Transactional outbox** for the `invitation.email.send` enqueue — recorded in ADR 0006 as the upgrade path; v1 enqueues after commit and accepts the documented post-commit gap. M08 lands the BullMQ processor itself.

## Tests

- **Unit** (`PurchasesService.spec.ts`, 6 cases): transactional write happy path, rollback on invitation failure, rollback on idempotency persistence failure, course-missing fast path, `listForParent` empty + composed paths. Replay body shape (`{ purchaseId, invitationId }`) is asserted explicitly.
- **E2E** (`purchases.e2e-spec.ts`, 9 cases): happy path, RBAC 403 for STUDENT, replay-same-body returns the stored minimal body, replay-different-body returns 409, missing/malformed `Idempotency-Key` returns 400, public catalog list, `GET /me/purchases` shape, unauthenticated 401.

## See also

- [Architecture overview](../architecture/overview.md)
- [Data model — `purchases`, `invitations`, `idempotency_keys`](../architecture/data-model.md)
- [ADR 0006 — Retries & idempotency](../architecture/adr/0006-retries-and-idempotency.md)
- [Code conventions](../best-practices/code-conventions.md)
