# M04 — Parent Purchase & Invitation

> **Status:** pending · **Owner:** mes-orchestrator → mes-shared-maintainer → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe

## Goal

Parent can browse courses, complete a mock checkout, and receive an invitation link to share with the student. Purchase endpoint is idempotent; purchase + invitation are written in a single transaction.

## Depends on

M03 (auth + RBAC + logging).

## Deliverables

### Shared package

- `packages/shared/src/enums/PurchaseStatusEnum.ts` — `PENDING`, `COMPLETED`, `FAILED`.
- `packages/shared/src/enums/InvitationStatusEnum.ts` — `ISSUED`, `REDEEMED`, `EXPIRED`.
- `packages/shared/src/enums/CourseSubjectEnum.ts` — `MATHS`, `ENGLISH`, `SCIENCE`.
- `packages/shared/src/types/ICourseResponse.ts`, `IPurchaseResponse.ts`, `IInvitationResponse.ts`.
- `packages/shared/src/schemas/createPurchaseSchema.ts` — `{ courseId: number; studentEmail: string }`.

### Backend

- `courses/` — `CourseEntity`, `CoursesRepository`, `CoursesService`, `CoursesController` (`GET /courses`). Seeded data: Maths Y5–Y13, English Y5–Y13, Science Y5–Y11 (per the spec), price £199 each.
- `purchases/` — `PurchaseEntity`, `PurchasesRepository`, `PurchasesService`, `PurchasesController` (`POST /purchases`, `GET /me/purchases`).
- `invitations/` — `InvitationEntity`, `InvitationsRepository`, `InvitationsService` (issue + lookup + mark redeemed; redemption itself is M05).
- `common/idempotency/` — `IdempotencyKeyEntity`, repository, `IdempotencyInterceptor` reading the `Idempotency-Key` header on POST endpoints.
- `POST /purchases` — guarded `@Roles(UserRoleEnum.PARENT)`, accepts `Idempotency-Key` header, validates body, runs in single transaction: insert purchase → insert invitation (signed token) → store idempotency record → return `IPurchaseResponse` containing the invitation URL.

### Migrations

- `<ts>-CreateCoursesTable.ts` + seed (use migration or a separate seed script).
- `<ts>-CreatePurchasesTable.ts` — FK to `users.user_id` (parent), FK to `courses.course_id`, `status` CHECK, `idempotency_key` indexed, `created_at`.
- `<ts>-CreateInvitationsTable.ts` — `token` UNIQUE, FK to `purchases.purchase_id`, `student_email`, `status`, `expires_at`, `redeemed_at` nullable.
- `<ts>-CreateIdempotencyKeysTable.ts` — `key UNIQUE`, `user_id`, `endpoint`, `response_body jsonb`, `created_at`, retention policy noted.

### Frontend (`apps/web/`)

- Product page `/courses` — fetches courses, lists them with subject, year range, price.
- Course detail `/courses/:id` — "Buy access for a student" CTA.
- Checkout page `/checkout/:courseId` — form (student email), generates `Idempotency-Key` UUID on page load, submits with `retry: false`.
- Success page `/checkout/success` — shows invitation URL with "copy to clipboard".
- Parent-only routes guarded via the auth store + role check.

## Agent dispatch plan

1. **mes-shared-maintainer** lands enums + types + Zod schemas.
2. **mes-backend-nestjs** lands modules + migrations + idempotency interceptor + transaction.
3. **mes-frontend-react** lands product page → checkout → success in `apps/web/`.
4. **mes-qa-engineer** writes:
   - Unit: `PurchasesService.spec.ts` covering transaction rollback on invitation failure.
   - Integration: `purchases.e2e-spec.ts` — happy path, only PARENT role, replay with same `Idempotency-Key` returns original, replay with different body + same key returns 409.
   - Frontend: checkout form validation, success page renders invitation URL.
5. **Reviewers in parallel:** security (idempotency-key isolation per user, RBAC on POST), logic (state transitions, transaction integrity), clean-code (repository pattern, DTO separation).
6. **mes-scribe** writes `docs/features/parent-purchase.md` + closes work-log.

## Definition of Done

- Parent signup → login → buy Maths Y7 → receive invitation URL works end-to-end against the Docker stack.
- Replaying the same `Idempotency-Key` returns the original purchase (verified by test + manual `curl`).
- Non-PARENT role attempting `POST /purchases` returns 403.
- All reviewers report no blockers.

## Verification

Manual:
1. Open `web` in browser, sign up as parent.
2. Browse `/courses`, pick Maths Year 7, click "Buy".
3. Complete checkout form with `student@example.com`.
4. See success page with invitation URL.
5. Reload and re-submit checkout — get the same purchase (idempotent).

Automated: `pnpm --filter backend test:e2e` green.

## Outcome

(filled by mes-scribe at close)
