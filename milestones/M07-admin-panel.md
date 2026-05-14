# M07 — Admin Panel

> **Status:** pending · **Owner:** mes-orchestrator → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe

## Goal

A read-only admin panel served by `apps/admin/` lets the seeded ADMIN user inspect parents, students, purchases, and courses.

## Depends on

M03 (admin role exists), M04 (purchases exist), M05 (students exist).

## Deliverables

### Shared package

- `packages/shared/src/types/IPaginated.ts` — `{ data: T[]; total: number; page: number; limit: number }`.
- `packages/shared/src/schemas/paginationSchema.ts` — `{ page: number; limit: number }` with defaults (page=1, limit=20).

### Backend

- `admin/` module with `@Roles(UserRoleEnum.ADMIN)` on every endpoint.
- `GET /admin/parents`, `GET /admin/students`, `GET /admin/purchases`, `GET /admin/courses` — paginated, ordered by `created_at DESC`.
- Use `PaginationDto` (request) → `IPaginated<T>` (response) types from `packages/shared/`.

### Frontend (`apps/admin/`)

- Login page (reuses auth API). Refuses non-ADMIN roles with a clear message.
- Layout with sidebar: Parents / Students / Purchases / Courses.
- Each page is a paginated table (server-side pagination). Tailwind + shadcn primitives.

## Agent dispatch plan

| Wave | Agents (dispatched in one message) | Runs after |
|------|-------------------------------------|------------|
| 1 | `mes-scribe` — log start time in work-log | — |
| 2 | `mes-shared-maintainer` — `IPaginated<T>`, `paginationSchema` | Wave 1 |
| 3 | `mes-backend-nestjs` **∥** `mes-frontend-react` | Wave 2 |
| 4 | `mes-qa-engineer` — ADMIN-only guard, pagination, PARENT rejected | Wave 3 |
| 5 | `mes-review-security` **∥** `mes-review-logic` **∥** `mes-review-clean-code` | Wave 4 |
| 6 | `mes-scribe` — `docs/features/admin-panel.md`, close work-log row | Wave 5 |

**Wave 3 detail (parallel):**
- `mes-backend-nestjs`: `admin/` module, `GET /admin/parents`, `/admin/students`, `/admin/purchases`, `/admin/courses` — all `@Roles(ADMIN)`, paginated, ordered `created_at DESC`.
- `mes-frontend-react`: login page (reuses auth API, rejects non-ADMIN), sidebar layout, four paginated table pages — in `apps/admin/`.

## Verification

- ADMIN logs into admin panel, sees the parent + student + purchase created via M04/M05 flow.
- A PARENT logging into the admin panel sees the "ADMIN only" message and cannot reach data.

## Outcome

**Status:** ✓ Done (+ Wave 8 polish)

Shipped admin panel with backend module (4 endpoints: parents, students, purchases, courses — all paginated, ordered DESC, @Roles(ADMIN)) and frontend SPA (`apps/admin/` — login with ADMIN guard, sidebar layout, 4 data tables with URL-synced pagination). Tests: 5 backend e2e + 8 frontend unit, all green. Initial review: 0 blockers. Post-close Wave 7 re-review uncovered 8 medium findings (proxy IP throttler, Zod error envelope, 401 session handler, magic constants, parameter nesting, blank lines, cohesion, cast comment). Wave 8 remediated all (28 backend + 13 frontend tests all green). All verification steps passed. Follow-ups deferred: XSS/localStorage (cross-app), rate limiting on /auth/login (cross-app).
