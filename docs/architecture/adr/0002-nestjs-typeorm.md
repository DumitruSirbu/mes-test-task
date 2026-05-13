# ADR 0002 — NestJS 11 + TypeORM + Postgres 16

- **Status:** Accepted (2026-05-13)
- **Deciders:** mes-architect, mes-orchestrator
- **Tags:** backend-stack, persistence

## Context

We need a backend stack that delivers, in a 3–4 hour budget:

- Strong opinionated structure (so reviewers see consistent patterns across modules).
- First-class DI for testability of services and processors.
- Guards, pipes, interceptors as composable cross-cutting hooks (RBAC, validation, idempotency).
- A migration-driven relational schema with FKs, CHECK constraints, unique indexes — the data model in `data-model.md` leans heavily on those.
- A repository pattern the codebase can wrap in a `BaseRepository` (already scaffolded in M01).
- Familiarity in the team's conventions (see `code-conventions.md`).

## Decision

- **HTTP framework:** NestJS 11 on the default Express adapter.
- **ORM:** TypeORM 0.3.x.
- **Database:** PostgreSQL 16.
- **Migration mode:** `synchronize: false` everywhere; schema changes only via timestamped migration files following `code-conventions.md`.
- **Index policy:** every index is decided in `data-model.md` (see the "Indexes (consolidated)" section there) and created explicitly inside a TypeORM migration. Because `synchronize` is off, indexes do **not** appear on the live schema unless a migration creates them — entity decorators (`@Index(...)`) are documentation only and MUST be mirrored by a `QueryRunner.createIndex(...)` call in the corresponding migration. Adding a new index is a migration; dropping one is a migration.
- **Fixed-vocabulary columns use PostgreSQL native ENUM types** (`user_role`, `course_subject`, `purchase_status`, `invitation_status`) — *not* `varchar + CHECK`. The full type catalogue and rationale live in `data-model.md` → "PostgreSQL ENUM types". TypeORM entity columns declare the type explicitly: `@Column({ type: 'enum', enum: UserRoleEnum, enumName: 'user_role' })`. The `enumName` MUST be passed explicitly so the generated migration matches the manual `CREATE TYPE`; never let TypeORM auto-name the type. Each migration that introduces an ENUM column creates the type via `CREATE TYPE` in the same `up()` and drops it via `DROP TYPE` in `down()` after the `DROP TABLE`.

## Consequences

**Positive:**

- NestJS gives:
  - Global `JwtAuthGuard` + `RolesGuard` via `APP_GUARD` — RBAC consistent across all controllers (ADR 0003).
  - Global `ValidationPipe` + `HttpExceptionFilter` (with `DomainError` hierarchy) — canonical error shape from day one (ADR 0005).
  - DI container — every service/processor is unit-testable by injecting a mock repository.
  - `@nestjs/bullmq`, `@nestjs/terminus`, `@nestjs/typeorm`, `nestjs-pino`, `nestjs-cls` — all map cleanly to the modules we need without bespoke wiring.
- TypeORM gives:
  - The `BaseRepository<T>` pattern in `code-conventions.md` — `findAll`, `create`, `insertManyIgnoreConflicts` — already in place.
  - First-class migrations with `QueryRunner` for tables, FKs, indexes — matches the migration rules in `code-conventions.md` exactly.
  - `dataSource.transaction()` is the simplest API for the M04 purchase + invitation atomic write (invoked via `BaseRepository.transaction(...)`; services never inject `DataSource` directly — see code-conventions.md).
- Postgres gives:
  - Native ENUM types for fixed-vocabulary columns (`users.role`, `courses.subject`, `purchases.status`, `invitations.status`) — 4-byte storage, declaration-order sorting, type-safe parse error on an unknown literal. The DB-level enforcement of `UserRoleEnum` / `CourseSubjectEnum` / `PurchaseStatusEnum` / `InvitationStatusEnum`. See `data-model.md` → "PostgreSQL ENUM types".
  - CHECK constraints for numeric invariants (`price_pence >= 0`, `amount_pence >= 0`) — keeps the DB honest on non-enum business rules.
  - `jsonb` for `idempotency_keys.response_body` — replay-safe responses.
  - Strong ACID for the purchase transaction.

**Negative / acknowledged trade-offs:**

- TypeORM 0.3 still has rough edges around relation typing in `find()` options; we lean on explicit query builders for non-trivial reads. Reviewers should flag long chained `.where(...).andWhere(...)` blocks for extraction into a repository method.
- NestJS adds boilerplate (modules, providers) that a pure Express app wouldn't. The boilerplate is the cost of getting consistent guards/pipes/filters across N controllers; for this scope it's a win.

## Alternatives considered

### Prisma

Better DX (autocomplete on relations, single migration tool, type-safe queries). Rejected for v1 because:

- The team's `code-conventions.md` already describes a `BaseRepository<T>` pattern and migration rules in TypeORM terms — moving to Prisma forks the convention.
- Prisma's migration model (`prisma migrate`) is great but adds a separate generate step + `node_modules/.prisma` artefact to the Docker workflow.
- The data model is small (7 tables); Prisma's productivity win shows up at larger scale.

Reconsider when the schema grows past ~15 tables or when relational typing becomes a regular drag.

### Fastify (without NestJS)

Faster requests per second, lower memory. Rejected because:

- We lose the NestJS module/guard/pipe ecosystem — every cross-cutting concern (RBAC, validation, error filter, idempotency interceptor, request CLS, BullMQ wiring) becomes hand-rolled.
- The performance edge is not the bottleneck at this scope.
- `nestjs-pino` + `nestjs-cls` give us structured logging and request correlation in two lines — replicating that on bare Fastify costs hours.

NestJS *can* use the Fastify adapter; we stay on Express for v1 because every reviewer knows it and the ecosystem of middleware is friendlier.

### MikroORM

Considered. Comparable feature set to TypeORM; the data-mapper API is arguably cleaner. Rejected only on the basis that the existing conventions are TypeORM-shaped — switching ORMs for marginal API improvement isn't a budget-friendly move.

### Postgres as a document store (JSONB-heavy)

Rejected. The data is genuinely relational (user ↔ purchase ↔ invitation ↔ enrolment ↔ course ↔ lessons). FKs and uniqueness constraints catch real bugs; collapsing into JSONB throws away most of the DB's value.

## See also

- [0001-modular-monolith.md](./0001-modular-monolith.md)
- [0005-logging-and-error-handling.md](./0005-logging-and-error-handling.md)
- [../data-model.md](../data-model.md)
- [../../best-practices/code-conventions.md](../../best-practices/code-conventions.md) — entity, repository, migration rules
