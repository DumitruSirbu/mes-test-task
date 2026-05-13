# Architecture Overview

> Status: stub. Filled in M02 by `mes-architect`.

High-level prose + diagram of how the system fits together.

## Service inventory

- **`apps/backend`** — NestJS 11 API (modular monolith). Modules: `auth`, `users`, `courses`, `purchases`, `invitations`, `lms`, `notifications`, `admin`, `health`, `common`.
- **`apps/web`** — Vite + React SPA for parents and students.
- **`apps/admin`** — Vite + React SPA for admins.
- **`packages/shared`** — TS types + Zod schemas; consumed by all three apps.
- **postgres** — primary store, schema migrated via TypeORM.
- **redis** — BullMQ broker for async work.

## Data flow (to be diagrammed in M02)

```
web/admin ──HTTP(JWT)──> backend ──SQL──> postgres
                              │
                              └──BullMQ──> redis ──> backend worker
```

## See also

- `docs/architecture/data-model.md`
- `docs/architecture/auth-and-rbac.md`
- `docs/architecture/async-jobs.md`
- `docs/architecture/adr/`
