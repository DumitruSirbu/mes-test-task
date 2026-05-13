# M07 — Admin Panel

> **Status:** pending · **Owner:** mes-orchestrator → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe

## Goal

A read-only admin panel served by `apps/admin/` lets the seeded ADMIN user inspect parents, students, purchases, and courses.

## Depends on

M03 (admin role exists), M04 (purchases exist), M05 (students exist).

## Deliverables

### Backend

- `admin/` module with `@Roles(UserRoleEnum.ADMIN)` on every endpoint.
- `GET /admin/parents`, `GET /admin/students`, `GET /admin/purchases`, `GET /admin/courses` — paginated, ordered by `created_at DESC`.
- Use `PaginationDto` (request) → `IPaginated<T>` (response) types from `packages/shared/`.

### Frontend (`apps/admin/`)

- Login page (reuses auth API). Refuses non-ADMIN roles with a clear message.
- Layout with sidebar: Parents / Students / Purchases / Courses.
- Each page is a paginated table (server-side pagination). Tailwind + shadcn primitives.

### Verification

- ADMIN logs into admin panel, sees the parent + student + purchase created via M04/M05 flow.
- A PARENT logging into the admin panel sees the "ADMIN only" message and cannot reach data.

## Outcome

(filled by mes-scribe at close)
