# M02 — Architecture & ADRs

> **Status:** pending · **Owner:** mes-orchestrator → mes-architect → mes-scribe

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

(filled by mes-scribe at close)
