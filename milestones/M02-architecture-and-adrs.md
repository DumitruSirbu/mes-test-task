# M02 — Architecture & ADRs

> **Status:** done (2026-05-13) · **Owner:** mes-orchestrator → mes-architect → mes-scribe

## Goal

Lock the architecture in writing before any feature code lands. The architect produces the decision artefacts (ADRs + supporting docs); future milestones cite them.

## Depends on

M01 (docs skeleton must exist).

## Deliverables

- `docs/architecture/overview.md` — module map, service inventory, a mermaid or ASCII diagram of `web ↔ admin ↔ backend ↔ postgres + redis`.
- `docs/architecture/data-model.md` — ER diagram + per-table column intent for: `users`, `parents`, `students`, `courses`, `purchases`, `invitations`, `enrolments`, `lessons`, `idempotency_keys`.
- `docs/architecture/auth-and-rbac.md` — JWT shape (`IJwtPayload`), `UserRoleEnum`, guard placement (global JwtAuthGuard via `APP_GUARD`, `@Public()` decorator, `@Roles()` decorator + `RolesGuard`), password hashing (argon2, parameters chosen).
- `docs/architecture/async-jobs.md` — queue inventory, BullMQ config, the `invitation.email.send` job payload, retry policy, idempotency rules.
- ADRs (one decision per file, `Context → Decision → Consequences → Alternatives considered`):
  - **0001 — Modular monolith over microservices.** Explicit deep analysis. Document the seams (`auth`, `users`, `courses`, `purchases`, `invitations`, `lms`, `notifications`) and which would split first if scaled. Reference the 3-4h budget and single-`docker-compose-up` constraint as drivers.
  - **0002 — NestJS + TypeORM + Postgres.** Why not Prisma; why not Fastify alone.
  - **0003 — Stateless JWT auth.** Access token expiry, refresh strategy (in scope or deferred), secret rotation note.
  - **0004 — BullMQ for async work.** Why Redis-backed queue over cron/in-process. Job idempotency requirement.
  - **0005 — Logging & error handling.** `nestjs-pino` + `nestjs-cls`, `AllExceptionsFilter`, canonical error shape, redaction.
  - **0006 — Retries & idempotency.** Three retry surfaces (BullMQ jobs, payment/purchase, frontend HTTP); idempotency-key storage; transactional consistency.

## Agent dispatch plan

1. **mes-architect** drafts overview + data model + auth/RBAC + async-jobs docs and all 6 ADRs.
2. **mes-review-logic** reads the docs for internal consistency (does the data model support the flows described?).
3. **mes-review-security** reads ADR 0003 + auth-and-rbac.md for security correctness.
4. **mes-scribe** copy-edits, ensures cross-links, updates `CLAUDE.md` if any new doc was added.

## Definition of Done

- Every ADR has all four sections filled.
- ADR 0001 contains an explicit, defensible monolith-vs-microservices analysis.
- Data model covers every entity needed for M03–M08.
- No application code committed in this milestone.

## Verification

- Manual read-through by orchestrator. Cross-reference data model against milestones M03–M08 deliverables — anything missing is a blocker.
- `markdown-link-check` (or manual) — no broken intra-repo links.

## Outcome

Closed 2026-05-13. Docs-only milestone — no application code touched.

### Filled / finalised

**Architecture docs (`docs/architecture/`):**

- `overview.md` — one-paragraph summary, service inventory table, backend module map with allowed-dependency rules, synchronous + async data-flow diagrams, runtime topology, cross-cutting concerns matrix, explicit non-goals.
- `data-model.md` — entity inventory + ER diagram, full per-column schema for `users`, `courses`, `purchases`, `invitations`, `enrolments`, `lessons`, `idempotency_keys` (column / type / constraints / notes), indexes per table, state machines for `purchases.status` and `invitations.status`, course seed list, migrations roadmap mapped to milestones. Decision recorded: no separate `parent_profiles` / `student_profiles` tables in v1.
- `auth-and-rbac.md` — `UserRoleEnum` + how each role is created, `IJwtPayload` shape + signing params, global guard wiring (`JwtAuthGuard` + `RolesGuard` via `APP_GUARD`), `@Public()` and `@Roles()` decorators, complete endpoint → role matrix for M03–M08, argon2id parameters, login flow diagram, failure-code mapping table, frontend role-enforcement notes, secret-rotation procedure.
- `async-jobs.md` — queue inventory, BullMQ connection wiring, `invitation.email.send` payload + options + processor reference implementation, three-layer idempotency (queue-level `jobId` dedup → processor `email_sent_at` check → conditional `UPDATE`), producer contract (post-commit enqueue + rationale), graceful shutdown, optional Bull Board mount, observability + test plan.

**ADRs (`docs/architecture/adr/`):** all 6 expanded to full Status / Context / Decision / Consequences / Alternatives sections.

- `0001-modular-monolith.md` — explicit monolith-vs-microservices analysis, 3-4h budget + single-`docker compose up` cited as drivers, seams for future split table (`notifications`, `payments`, `lms`, `admin`).
- `0002-nestjs-typeorm.md` — Nest 11 + TypeORM 0.3 + Postgres 16; alternatives: Prisma, Fastify alone, MikroORM, JSONB-only — each with explicit rejection reason.
- `0003-jwt-stateless-auth.md` — HS256, 15m TTL, refresh deferred to v2 with documented rotation procedure (`kid`-based), failure → error code mapping.
- `0004-bullmq-for-async.md` — Redis-backed BullMQ, one queue per concern, alternatives: `@nestjs/schedule`, EventEmitter, `pg-boss`, Kafka/RabbitMQ/SQS.
- `0005-logging-and-error-handling.md` — `nestjs-pino` + `nestjs-cls`, redact config including partial email mask, canonical error shape, `DomainException` base class, validation pipe config, frontend `ApiError` + ESLint rule.
- `0006-retries-and-idempotency.md` — three retry surfaces with distinct policies, `idempotency_keys` table schema cited, request_hash mismatch → 409 rule, post-commit enqueue gap acknowledged with outbox pattern as upgrade path.

### DoD check

- [x] Every ADR has Status / Context / Decision / Consequences / Alternatives sections filled.
- [x] ADR 0001 contains an explicit, defensible monolith-vs-microservices analysis (3-4h budget, single deployable, future-split seams).
- [x] Data model covers every entity needed for M03–M08: `users` (M03), `courses` + `purchases` + `invitations` + `idempotency_keys` (M04), `enrolments` (M05), `lessons` (M06); admin reads (M07) use the same tables; `invitations.email_sent_at` declared upfront for M08.
- [x] No application code committed in this milestone.
- [x] Intra-repo links spot-checked.

### Outcome — fixes applied

Four follow-up architect passes after initial reviewer audit (2026-05-13, 13:05–13:35):

1. **Reviewer fixes pass** — applied 30 items from logic/security/clean-code reviews: redeem flow disambiguated, atomic conditional UPDATE for invitation redeem, `PENDING`/`FAILED` deferred to v2, admin resend endpoint added, consolidated error-code table with `*Error` class mapping, in-memory token storage (no localStorage), rate-limiting + CORS sections, opaque random invitation tokens (`token_hash` column), JWT alg pinning, argon2id `parallelism: 1`, JCS canonicalisation, `/me/*` IDOR invariant.

2. **Custom error classes** — promoted `DomainException` to documented `DomainError extends Error` hierarchy: canonical v1 inventory (`InvitationNotFoundError`, `InvitationExpiredError`, `InvitationAlreadyRedeemedError`, `InvitationEmailConflictError`, `IdempotencyKeyRequiredError`, `IdempotencyKeyReusedError`, `IdempotencyBodyMismatchError`, `CourseNotFoundError`, `EnrolmentNotFoundError`, `EnrolmentAlreadyExistsError`, `ValidationFailedError`, `RateLimitedError`, `UnauthorizedError`, `ForbiddenError`, `UserEmailTakenError`); global `HttpExceptionFilter` maps to canonical JSON shape.

3. **DB index audit** — consolidated all 12 v1 indexes in `data-model.md` with per-index justification; removed 2 speculative (`IDX_courses_subject`, `IDX_invitations_status_expires`); documented "considered but rejected" with reintroduction triggers.

4. **PG native ENUM types** — converted `users.role`, `courses.subject`, `purchases.status`, `invitations.status` from `varchar + CHECK` to native PG ENUMs (`user_role`, `course_subject`, `purchase_status`, `invitation_status`); storage compact (4 bytes vs ~17), v2 upgrade path documented.

### Notes for downstream milestones

- `email_sent_at` is declared as part of the original M04 `CreateInvitationsTable` migration to avoid an M08 `ALTER`. M08 then only adds the processor.
- `idempotency_keys.user_id` deliberately has no FK — keys are retained for audit even if the user is deleted.
- Enrolment cross-tenant checks are enforced in the service (return 404, not 403) to avoid leaking lesson existence.
