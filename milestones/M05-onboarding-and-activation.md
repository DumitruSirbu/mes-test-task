# M05 — Student Onboarding & Activation

> **Status:** done · **Owner:** mes-orchestrator → mes-shared-maintainer → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe

## Goal

A student opens the invitation link, completes onboarding, sets a password, and is redirected into the LMS dashboard authenticated as a STUDENT.

## Depends on

M04 (invitations exist and carry tokens).

## Deliverables

### Shared package

- `packages/shared/src/schemas/redeemInvitationSchema.ts` — `{ token: string; firstName: string; lastName: string; dateOfBirth: string; password: string }` with strength rules.

### Backend

- `invitations/` — `POST /invitations/redeem` (Public). Verifies token, checks `ISSUED` + not expired, runs in transaction:
  - create `students` row (or `users` row with `STUDENT` role + linked student profile per data model)
  - create `enrolments` row for the course bought in the originating purchase
  - mark invitation `REDEEMED` with `redeemed_at`
  - return JWT for the new student.
- Domain exceptions: `InvitationNotFoundException`, `InvitationExpiredException`, `InvitationAlreadyRedeemedException` — each carries a stable `code`.

### Frontend (`apps/web/`)

- `/onboard/:token` — fetches invitation metadata (Public endpoint `GET /invitations/:token/meta` returning course + parent email, without exposing token internals), shows landing.
- Onboarding form — RHF + zodResolver against `redeemInvitationSchema`. Server-side validation errors mapped by field.
- On success: store token in auth state, redirect to `/lms`.

## Agent dispatch plan


| Wave | Agents (dispatched in one message)                                           | Runs after |
| ---- | ---------------------------------------------------------------------------- | ---------- |
| 1    | `mes-scribe` — log start time in work-log                                    | —          |
| 2    | `mes-shared-maintainer` — `redeemInvitationSchema` + shared types            | Wave 1     |
| 3    | `mes-backend-nestjs` **∥** `mes-frontend-react`                              | Wave 2     |
| 4    | `mes-qa-engineer` — integration + frontend tests                             | Wave 3     |
| 5    | `mes-review-security` **∥** `mes-review-logic` **∥** `mes-review-clean-code` | Wave 4     |
| 6    | `mes-scribe` — `docs/features/student-onboarding.md`, close work-log row     | Wave 5     |


**Wave 3 detail (parallel):**

- `mes-backend-nestjs`: `POST /invitations/redeem`, `GET /invitations/:token/meta`, domain exceptions, transaction.
- `mes-frontend-react`: `/onboard/:token` route, landing page, onboarding form (RHF + zodResolver), success redirect to `/lms`.

**Wave 4 detail:**

- Integration: redeem happy path; expired token → 410; already-redeemed → 409; bad token → 404.
- Frontend: form validation errors mapped by field; success stores JWT and redirects.

## Definition of Done

- Parent's invitation URL from M04 → onboard → land on `/lms` authenticated as STUDENT works end-to-end.
- Token cannot be redeemed twice.
- All reviewers report no blockers.

## Outcome

Shipped `POST /invitations/redeem` + `GET /invitations/:token/meta` (Public, both HTTP 410 oracle-resistant per ADR 0005).
Created `enrolments` migration + `EnrolmentEntity` + `EnrolmentsRepository`. Four invitation domain errors
(all HTTP 410): `InvitationNotFoundError`, `InvitationExpiredError`, `InvitationAlreadyRedeemedError`, `InvitationEmailConflictError`.
Frontend: `/onboard/:token` route with RHF form (firstName, lastName, dateOfBirth, password, confirmPassword), JWT decode,
authStore write, `/lms` redirect. Stub LmsPage. Shared: `redeemInvitationSchema`, `IInvitationMetaResponse`, `IAuthTokenResponse`.
Tests: 9 backend e2e + 11 frontend unit, all passing. Two review rounds — all blockers resolved.
Carry-overs to M06: argon2 timing oracle, rate limiting, dateOfBirth real-date check,
repo BaseRepository bypass, error codes not in shared.