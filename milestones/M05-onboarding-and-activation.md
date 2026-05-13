# M05 — Student Onboarding & Activation

> **Status:** pending · **Owner:** mes-orchestrator → mes-shared-maintainer → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe

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

1. **mes-shared-maintainer** lands the schema.
2. **mes-backend-nestjs** lands the endpoint + service + transaction.
3. **mes-frontend-react** lands `/onboard/:token` and form.
4. **mes-qa-engineer** writes:
   - Integration: redeem happy path; expired token → 410; already-redeemed → 409; bad token → 404.
   - Frontend: form validation, success redirect.
5. **Reviewers in parallel.**
6. **mes-scribe** writes `docs/features/student-onboarding.md`.

## Definition of Done

- Parent's invitation URL from M04 → onboard → land on `/lms` authenticated as STUDENT works end-to-end.
- Token cannot be redeemed twice.
- All reviewers report no blockers.

## Outcome

(filled by mes-scribe at close)
