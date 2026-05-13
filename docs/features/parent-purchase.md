# Feature — Parent Purchase

> Status: stub. Filled in M04 by `mes-scribe` after implementation.

## Flow

1. Parent visits `/courses`, sees catalog.
2. Selects a course, lands on `/courses/:id`.
3. Clicks "Buy", lands on `/checkout/:courseId` — form with `studentEmail`.
4. On page load, a UUID `Idempotency-Key` is generated and held in component state.
5. Submitting the form `POST /purchases` with header `Idempotency-Key: <uuid>` and body `{ courseId, studentEmail }`.
6. Backend (in one transaction): inserts purchase, inserts invitation (signed token, 72h TTL), records idempotency key + response, returns `{ purchaseId, invitationUrl }`.
7. After commit, backend enqueues `invitation.email.send` job (M08).
8. Frontend redirects to `/checkout/success` showing the invitation URL with a "copy" button.

## RBAC

- `POST /purchases` requires `@Roles(PARENT)`.
- `GET /me/purchases` requires authenticated user; returns own purchases only.

## Edge cases

- Retry with same `Idempotency-Key` → original response.
- Retry with same key + different body → 409 `IDEMPOTENCY_KEY_MISMATCH`.
- Non-existent course id → 404.
- Non-parent role → 403.
