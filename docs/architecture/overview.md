# Architecture Overview

> **Status:** finalised in M02 by `mes-architect`. Cross-cuts every later milestone. Implementation lives in M03+.

This document gives a single-page mental model of the MES test-task system. For deep dives see the linked sub-docs and ADRs.

## One-paragraph summary

A small modular-monolith NestJS API (`apps/backend`) sits behind two Vite + React SPAs — `apps/web` (parent + student) and `apps/admin` (admin). Postgres is the source of truth; Redis backs BullMQ for fire-and-forget work (today: invitation email "send"). All TypeScript types, enums, and Zod schemas that cross the wire are owned by `packages/shared`. JWT (HS256, stateless) carries the role; a global `JwtAuthGuard` + `RolesGuard` enforces RBAC at the controller layer. Everything boots with one `docker compose up`.

## Service inventory

| Service / package | Purpose | Port (host) | Owner module(s) |
|---|---|---|---|
| `apps/backend` | NestJS 11 REST API + BullMQ worker (same process) | 3010 | all backend modules |
| `apps/web` | Parent + student SPA | 5173 | n/a |
| `apps/admin` | Read-only admin SPA | 5174 | n/a |
| `packages/shared` | Cross-cutting TS types, enums, Zod schemas | — | `mes-shared-maintainer` |
| postgres 16 | Source of truth, TypeORM-migrated | 5432 | n/a |
| redis 7 | BullMQ broker | 6379 | n/a |

## Module map (backend)

The backend is split along business capability seams. Each module owns its entities, repositories, services, controllers, and (where relevant) processors. Modules never reach into another module's repositories — cross-module work goes via the other module's service.

```
apps/backend/src/
├── auth/              # signup, login, JWT issue/verify, guards, decorators
├── users/             # UserEntity + repository; profile lookups
├── courses/           # CourseEntity, catalog (GET /courses)
├── purchases/         # PurchaseEntity, idempotent POST /purchases
├── invitations/       # InvitationEntity, redeem flow, token verify
├── lms/               # LessonEntity, enrolment lookups, /me/courses
├── notifications/     # BullMQ queue + processor (invitation.email.send)
├── admin/             # ADMIN-only paginated read endpoints
├── health/            # /health/live + /health/ready (terminus)
└── common/            # BaseRepository, HttpExceptionFilter, DomainError + subclasses,
                       # IdempotencyInterceptor, logger + CLS modules
```

Allowed dependency direction:

- `auth` → `users` (look up user by email/id).
- `purchases` → `courses`, `invitations`, `notifications` (enqueue job after commit).
- `invitations` → `users`, `lms` (create student + enrolment on redeem).
- `lms` → `courses` (lessons hang off courses).
- `admin` → `users`, `purchases`, `courses` (read-only).
- `common` is depended on by everyone; depends on nothing.

If you find yourself wanting a reverse edge (e.g., `courses` importing from `purchases`), that's the signal to lift the type into `packages/shared` or rethink the boundary.

## Data flow

### Synchronous request (browser → API → DB)

```
┌─────────┐   HTTPS+JWT   ┌──────────────────────┐   SQL   ┌──────────┐
│ web /   │ ────────────► │ NestJS API           │ ──────► │ postgres │
│ admin   │ ◄──────────── │ (guards → pipes →    │ ◄────── │          │
└─────────┘    JSON       │  controllers →       │         └──────────┘
                          │  services →          │
                          │  repositories)       │
                          └──────────────────────┘
```

### Asynchronous flow (purchase → invitation email)

```
POST /purchases
   │
   ▼
┌─────────────────────────────────────────────┐
│ TypeORM transaction                         │
│   INSERT purchases                          │
│   INSERT invitations (signed token)         │
│   INSERT idempotency_keys                   │
└─────────────────────────────────────────────┘
   │  commit
   ▼
┌─────────────────┐  add(...)  ┌────────┐  process()  ┌──────────────────────┐
│ PurchasesService├───────────►│ redis  ├────────────►│ InvitationEmail      │
│                 │            │ BullMQ │             │ Processor            │
└─────────────────┘            └────────┘             │  - check email_sent_at│
                                                       │  - "send" (log)      │
                                                       │  - set email_sent_at │
                                                       └──────────────────────┘
```

The enqueue happens **after** the transaction commits — Redis is not transactional with Postgres, so the outbox-style guarantee is intentionally deferred. See ADR 0006.

## Runtime topology

```
                ┌────────────────────────────────────────────┐
                │ docker compose up                          │
                │                                            │
   browser ────►│  apps/web (5173) ─────┐                    │
                │                       │                    │
                │  apps/admin (5174) ───┼──► backend (3010)──┼──► postgres (5432)
                │                       │                    │
                │                       │                    └──► redis (6379)
                │                       │                    │
                │                                            │
                └────────────────────────────────────────────┘
```

Single deployable for the backend = API + worker in one process. In production the worker would split out, but the BullMQ wiring already supports that — only the process composition changes.

## Cross-cutting concerns (single source of truth)

| Concern | Where it's decided | Where it's implemented |
|---|---|---|
| Auth & RBAC | `auth-and-rbac.md` + ADR 0003 | `auth/` module + global guards in `AppModule` |
| Errors & logs | ADR 0005 | `common/HttpExceptionFilter` + `DomainError` hierarchy, `nestjs-pino`, `nestjs-cls` |
| Async work | `async-jobs.md` + ADR 0004 | `notifications/` + per-module producers |
| Retries & idempotency | ADR 0006 | `common/idempotency/` + frontend `apiClient` config |
| Data shapes that cross the wire | this doc + ADR 0002 | `packages/shared/` only |
| DB indexes | `data-model.md` → "Indexes (consolidated)" | Created explicitly in TypeORM migrations (no `synchronize`) |
| CORS | this doc | `main.ts` `app.enableCors(...)` |

### CORS posture

The backend enables CORS with an **allow-list** read from `CORS_ORIGINS` (comma-separated). No wildcard. `Access-Control-Allow-Credentials: false` — v1 carries no cookies (`Authorization: Bearer` header only). Requests from unlisted origins are rejected by the CORS middleware before reaching guards.

## Non-goals (for this test task)

- Multi-region or HA story.
- Real payment provider integration.
- Real email provider integration.
- Refresh token rotation (deferred — see ADR 0003).
- WebSocket / real-time UX.
- Frontend SSR.

## See also

- [data-model.md](./data-model.md)
- [auth-and-rbac.md](./auth-and-rbac.md)
- [async-jobs.md](./async-jobs.md)
- [adr/](./adr/)
- [../best-practices/code-conventions.md](../best-practices/code-conventions.md)
