# ADR 0001 — Modular Monolith over Microservices

- **Status:** Accepted (2026-05-13)
- **Deciders:** mes-architect, mes-orchestrator
- **Tags:** topology, scope

## Context

The MES test task asks for an end-to-end demonstration of the core journey **parent buys → student onboards → student uses LMS**, deliverable in a 3–4 hour budget and runnable via a single `docker compose up`. The evaluator explicitly weights architecture and engineering judgment, so "the obvious thing" needs a defensible rationale, not a shrug.

We must accommodate:

- Three audiences (parent, student, admin) with distinct UIs.
- Cross-cutting concerns: JWT-based RBAC, structured logging, idempotency, retries, async work.
- A real async pipeline (the invitation email mock) — not just a CRUD demo.
- Future-credibility: the design should not obviously break under realistic growth (more courses, real payments, real email).

The choice of overall topology shapes every later decision (deployment, observability, transaction boundaries, module dependency rules), so it's the first ADR.

## Decision

Build the backend as a **single NestJS service organised as a modular monolith**. Module boundaries are explicit and enforced by code-convention rules (each module owns its entities, services, controllers, and processors; cross-module access goes through the other module's service, not its repository). The agreed modules are:

`auth`, `users`, `courses`, `purchases`, `invitations`, `lms`, `notifications`, `admin`, `health`, plus a `common` package for shared infrastructure (base repository, exception filter, idempotency interceptor, logger module).

The two frontends (`apps/web`, `apps/admin`) remain separate Vite builds but share `packages/shared`.

## Consequences

**Positive:**

- One deployable, one `docker compose up` — fits the brief exactly.
- Cross-module transactions stay easy (purchase + invitation atomicity is a single TypeORM `dataSource.transaction` — invoked via `BaseRepository.transaction(...)`; services never inject `DataSource` directly — see code-conventions.md).
- Shared infrastructure (logger, CLS request id, error filter, validation pipe) is configured once.
- Reviewer focus stays on code quality and decision-making, not on inter-service plumbing.
- Module boundaries are enforced by **manual review** (the clean-code reviewer specifically checks for cross-module repository imports). An ESLint boundaries plugin is a v2 candidate, not a v1 commitment.

**Negative / acknowledged trade-offs:**

- Horizontal scaling is uniform — we cannot independently scale (say) the notification worker without splitting it out. Acceptable at this scope; flagged in "Seams for future split".
- A bug in any module crashes the whole process. Mitigated by the global `HttpExceptionFilter` (ADR 0005) and BullMQ's process-isolated retry on the async path.
- Tight coupling temptation: easier to grab another module's repository directly. The convention review and code-convention doc explicitly forbid this, and reviewers will flag it.

## Alternatives considered

### Microservices (3+ services + gateway)

Rejected. Overhead in build, deploy, debugging, intra-service contracts, and shared-type distribution exceeds the 3–4 hour budget. Microservices pay off when independent teams ship on independent cadences against different scaling profiles — this is one developer, one repo, one demo. We would be performing architecture rather than practising it.

### Serverless (functions per endpoint)

Rejected. Cold starts, fragmented logging/observability across function boundaries, and the difficulty of enforcing a single auth + idempotency policy consistently across N independent deployables. Also incompatible with `docker compose up` as the single quickstart.

### Worker as a separate process from the API

Considered, deferred. The BullMQ wiring already supports it — only the process composition changes. For v1, the worker is registered inside the same Nest app to keep `docker compose` to two services (db, cache) plus one app. The decision to split is one ADR + one `docker-compose.yml` change away.

## Seams for future split

The module map is deliberately drawn along the cuts a real growth path would make:

| Module | First reason to extract |
|---|---|
| `notifications` | Real email/push provider with its own SLA + retry semantics |
| `payments` (when real) | PCI / compliance isolation |
| `lms` | Content-heavy workloads — separate scaling and caching |
| `admin` | Sensitive read scopes — separate audit + network policy |

Each of these would extract cleanly today because they already only consume other modules' public service APIs, not their internals.

## See also

- [overview.md](../overview.md) — module map
- [0002-nestjs-typeorm.md](./0002-nestjs-typeorm.md)
- [0004-bullmq-for-async.md](./0004-bullmq-for-async.md)
- [../../best-practices/code-conventions.md](../../best-practices/code-conventions.md) — module ownership rules
