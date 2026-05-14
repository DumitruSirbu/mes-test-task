# MES Test Task

A small full-stack web app mocking the MES core user journey: **Parent purchases → Student onboards → Student accesses the LMS.**

> Status: M01 (foundation) in progress. Sections marked _(filled in MNN)_ will be populated by `mes-scribe` as milestones close.

---

## 1. Project overview

_(filled in M02 / M10)_

A parent buys access to a course for their child, receives an invitation link, the student onboards through that link, sets a password, and lands in a simple LMS where they can browse lessons. An admin panel exposes read-only views of parents, students, purchases, and courses.

The system is a **modular monolith** (one NestJS service, clean module boundaries) backed by **Postgres** and **Redis (BullMQ)**. Two React SPAs — `web` for parents and students, `admin` for admins. Full system runs with a single `docker compose up`.

## 2. Architecture overview

_(filled in M02 — diagram + prose)_

See `docs/architecture/overview.md`.

## 3. Tech stack

| Layer | Technology |
|---|---|
| Backend | NestJS 11, TypeORM, PostgreSQL 16, BullMQ, Redis 7 |
| Frontend | Vite, React 19, TypeScript, TanStack Query, React Router v6, React Hook Form, Zod, Tailwind v4, shadcn/ui |
| Shared package | TypeScript types + Zod schemas |
| Testing | Jest (backend), Vitest + Testing Library (frontend) |
| Runtime | Node 22 LTS, pnpm 9 |
| Container | Docker + docker-compose |

## 4. Installation & run

_(filled in M10 with the final exact commands)_

```bash
git clone <repo>
cd mes-test-task
cp .env.example .env     # required before docker compose up — never committed
docker compose up        # postgres + redis (+ apps in M10)
```

For local dev (without containerising the apps): `pnpm install`, then `pnpm dev:backend` (port 3010), `pnpm dev:web`, `pnpm dev:admin` in three terminals.

## 5. Environment variables

_(filled in M10 — table)_

See `.env.example`.

## 6. Seeded credentials

_(filled in M03 once seeding lands)_

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@mes.test` | _(TBD)_ |

## 7. End-to-end walkthrough

_(filled in M10)_

1. Sign up as a parent at http://localhost:5173/signup
2. Buy "Maths Year 7" → receive invitation URL
3. Open invitation URL in incognito → onboard → set password
4. Land on LMS dashboard → open Maths Y7 → open a lesson
5. Log into http://localhost:5174 as admin → see the new purchase + student

## 8. Key technical decisions

_(filled in M02 — short ADR summary table linking to `docs/architecture/adr/`)_

- ADR 0001 — Modular monolith over microservices
- ADR 0002 — NestJS + TypeORM + Postgres
- ADR 0003 — Stateless JWT auth
- ADR 0004 — BullMQ for async work
- ADR 0005 — Logging & error handling
- ADR 0006 — Retries & idempotency

## 9. AI usage

This project was built using a **Claude Code agents team**: a main orchestrator (`mes-orchestrator`) decomposes each task and dispatches specialists — architect, backend (NestJS), frontend (React), shared-contract maintainer, devops, QA, scribe, and three reviewers (security, business logic, clean code). Each agent runs on the Claude model best suited to its workload (Opus 4.7 for orchestration / architecture / deep reviews; Sonnet 4.6 for code-heavy work; Haiku 4.5 for mechanical docs/contract edits).

Pre-installed skills wired per agent: `nestjs-best-practices`, `supabase-postgres-best-practices`, `bullmq-specialist`, `redis-development`, `docker-expert`, `vite`, `vitest`, `tailwind-design-system`, `vercel-react-best-practices`, `typescript-advanced-types`, `javascript-typescript-jest`, `security-review`.

Artefacts: see `docs/ai-usage/` and `docs/work-log.md` for the time breakdown.

Agent definitions live in `.claude/agents/` (also accessible via `.agents/agents/` symlink).

## 10. Testing

```bash
pnpm --filter backend test           # unit
pnpm --filter backend test:e2e       # integration (requires postgres + redis)
pnpm --filter web test
pnpm --filter admin test
```

## 11. Project structure

```
.
├── .claude/agents/          # 11 agent definitions (orchestrator + specialists)
├── .agents/                 # symlinked agents + installed skills
├── apps/
│   ├── backend/             # NestJS API + workers
│   ├── web/                 # Parent + Student SPA
│   └── admin/               # Admin SPA
├── packages/
│   └── shared/              # TS types + Zod schemas (single source of truth)
├── docs/
│   ├── architecture/        # overview, data model, ADRs
│   ├── features/            # one file per user-facing feature
│   ├── best-practices/      # code conventions (AUTHORITATIVE)
│   ├── development/         # setup, docker, env
│   ├── ai-usage/            # transcripts + diff artefacts
│   └── work-log.md          # time tracking per task
├── milestones/              # M01..M10 plan-of-record briefs
├── CLAUDE.md                # how to work in this repo (orchestrator entry-point rule)
├── docker-compose.yml
├── .env.example
├── package.json             # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 12. Next steps / out of scope

_(finalised in M10 — see also ADRs)_

- Real payment integration (Stripe) — purchase endpoint is already idempotent so swap-in is straightforward.
- Real email delivery (SES/Sendgrid) — drop in a transport behind the `InvitationEmailProcessor`.
- Refresh-token rotation + revocation list.
- Observability stack (OpenTelemetry → Prometheus + Grafana, or a hosted APM).
- Splitting the backend into microservices — seams documented in ADR 0001.
