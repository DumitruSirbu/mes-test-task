# MES Test Task

A small full-stack web app mocking the MES core user journey: **Parent purchases → Student onboards → Student accesses the LMS.**

> Status: M01–M10 complete. All milestones closed; project is delivery-ready.

---

## 1. Project overview

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

**Single-command start (all services in Docker):**

```bash
git clone <repo> mes-test-task
cd mes-test-task
cp .env.example .env
docker compose up -d --build
docker compose ps          # wait ~30s; all services should be 'healthy'
curl http://localhost:3010/health/ready
```

On success, `curl` returns: `{"postgres":"up","redis":"up"}`.

**Service URLs:**
- **Web SPA** (parent + student): http://localhost:5173
- **Admin SPA**: http://localhost:5174
- **Backend API**: http://localhost:3010
- **Bull Board** (job queue visibility, ADMIN-gated): http://localhost:3010/admin/queues

**Teardown:**
```bash
docker compose down      # stop + remove containers
docker compose down -v   # also remove volumes (postgres data, redis cache)
```

**For local dev** (without containerising the apps): `pnpm install`, then `pnpm dev:backend` (port 3010), `pnpm dev:web`, `pnpm dev:admin` in three terminals.

## 5. Environment variables

Copy `.env.example` to `.env` before running the system. All variables below are consumed at runtime (dev defaults shown).

| Variable | Default | Purpose | Required in prod? |
|---|---|---|---|
| `NODE_ENV` | `development` | Runtime mode; set to `production` for deployments. | Y |
| `BACKEND_PORT` | `3010` | Backend service port. | N (default 3010) |
| `POSTGRES_USER` | `mes` | Database user. | Y |
| `POSTGRES_PASSWORD` | `mes_dev_password` | Database password. Rotate before prod deploy. | Y |
| `POSTGRES_DB` | `mes` | Database name. | N |
| `POSTGRES_HOST` | `postgres` | Database hostname (docker-compose service name). | N |
| `POSTGRES_PORT` | `5432` | Database port. | N |
| `REDIS_HOST` | `redis` | Redis hostname (docker-compose service name). | N |
| `REDIS_PORT` | `6379` | Redis port. | N |
| `JWT_SECRET` | `REPLACE_ME_WITH_OPENSSL_RAND_HEX_32_BYTES_...` | JWT signing secret. **Must be ≥64 hex chars in production.** Generate via `openssl rand -hex 32`. | Y |
| `JWT_EXPIRES_IN` | `10m` | Access token TTL. | N |
| `LOG_LEVEL` | `info` | Pino logger level (`debug`, `info`, `warn`, `error`). | N |
| `LOG_PRETTY` | `true` | Pretty-print JSON logs (false in prod for structured logging). | N |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Comma-separated CORS origin allow-list. Exact origins only; no wildcards. | Y |
| `INVITATION_TOKEN_TTL_HOURS` | `336` | Invitation link validity window (14 days). | N |
| `SEED_ADMIN_PASSWORD` | (migration hardcoded) | Seed password for admin user. Rotate before prod deploy. | Y |
| `WEB_PORT` | `5173` | Frontend (web SPA) dev server port. | N |
| `ADMIN_PORT` | `5174` | Admin SPA dev server port. | N |
| `VITE_API_BASE_URL` | `http://localhost:3010` | API endpoint URL used by frontend at build/runtime. | Y |

## 6. Seeded credentials

The database seeding migration (20260513140100) creates one admin user on fresh database:

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@mes.test` | `changeme-admin-12345` |

**⚠️ Rotate before any deploy.** Change the password on first production login. The seed password is visible in the migration file; it is for dev/test only. In production, generate a strong password (≥20 chars, mixed case + digits + symbols) and update via a separate admin CLI tool or database script before deployment.

## 7. End-to-end walkthrough

Start with `docker compose up -d` running (all services healthy). Then:

1. **Parent signup & purchase** — Open http://localhost:5173/signup in any browser.
   - Sign up: email, password, confirm.
   - Login and browse catalog (http://localhost:5173/catalog).
   - Select "Mathematics (Year 7)" → click **Buy course**.
   - Receive invitation URL and QR code.

2. **Student onboarding** — Open the invitation URL in **incognito window** (new session).
   - Metadata displays: course, parent email, expiry.
   - Fill onboarding form: first name, last name, date of birth (≥4 years old), password + confirm.
   - Submit → land on **LMS dashboard** (http://localhost:5173#/lms).

3. **Student explores LMS** — On `/lms` dashboard.
   - Click "Mathematics (Year 7)" → course detail page.
   - Click a lesson (e.g., "Fractions Intro") → lesson viewer displays content.

4. **Admin panel** — Open http://localhost:5174 in a fresh browser.
   - Login with `admin@mes.test` / `changeme-admin-12345`.
   - View:
     - **Parents** tab: the parent from step 1.
     - **Students** tab: the student from step 2.
     - **Purchases** tab: purchase record + invitation status (REDEEMED).
     - **Courses** tab: all available courses + student enrolment counts.
   - (Optional) **Bull Board** (job queue): http://localhost:3010/admin/queues (ADMIN role required).

**Notes:**
- The parent-side flow works in any browser; no cookies or session state required.
- Student onboarding link is single-use and expires after 14 days (configurable `INVITATION_TOKEN_TTL_HOURS`).
- Each browser/incognito session maintains its own token in memory — logout required to switch roles.

## 8. Key technical decisions

_(filled in M02 — short ADR summary table linking to `docs/architecture/adr/`)_

- ADR 0001 — Modular monolith over microservices
- ADR 0002 — NestJS + TypeORM + Postgres
- ADR 0003 — Stateless JWT auth
- ADR 0004 — BullMQ for async work
- ADR 0005 — Logging & error handling
- ADR 0006 — Retries & idempotency

## 9. AI usage

This project was built using a **Claude Code agents team**: 11 specialist agents directed by a main orchestrator. Each agent runs on the Claude model best suited to its workload (Opus for orchestration, Sonnet for implementation, Haiku for mechanical edits).

**Agents:** `mes-orchestrator`, `mes-architect`, `mes-backend-nestjs`, `mes-frontend-react`, `mes-shared-maintainer`, `mes-devops`, `mes-qa-engineer`, `mes-scribe`, `mes-review-security`, `mes-review-logic`, `mes-review-clean-code`. Definitions live in `.claude/agents/` (also accessible via `.agents/agents/` symlink).

**Work tracking:** Every dispatch and milestone closure is recorded in `docs/work-log.md` with start/end timestamps, agent(s), and outcome summary. The total from planning through M10 close is ~8.1h real-time.

**Artefacts:** Code reviews, test output, and transcripts are captured in `docs/ai-usage/` when non-trivial. This section is updated as artefacts accumulate.

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

## 12. Production hardening

This test task has been built to specification with all M01–M10 milestones closed and all tests passing (279/279). Before deploying to production, address the following deferred hardening items:

**Secrets & environment:**
- Rotate `JWT_SECRET` (generate ≥64 hex chars via `openssl rand -hex 32`), `SEED_ADMIN_PASSWORD` (set a strong password and update the migration), and `POSTGRES_PASSWORD` via your secrets store (Vault, AWS Secrets Manager, etc.).
- Set `NODE_ENV=production` (disables pretty-logging, enables secure cookie flags).
- Set `LOG_PRETTY=false` (structured JSON for log aggregation).
- Set `TRUST_PROXY=1` (or adjust to your reverse-proxy hop count). Direct-exposure deploys should set to `false`.
- Set `CORS_ALLOWED_ORIGINS=<your exact frontend origins>` (no wildcards; exact `https://...` URIs only).

**Cookies & CSRF:**
- Refresh token cookie policy: current `sameSite=lax; secure=true (in prod)` is correct for same-origin SPA + API deployments.
- Cross-origin deployments: change to `sameSite=none; secure` and add an explicit env switch in `AuthService.refresh()`.

**Request rate limiting:**
- `POST /auth/login` is throttled per IP + username (5/min). Production deployments should additionally rate-limit at the reverse proxy level (WAF rule) or add email-based brute-force detection.
- `GET /invitations/:token/meta` and `POST /invitations/redeem` are public; add per-IP throttling at the proxy or via WAF to slow token-discovery oracles.

**API security:**
- `/admin/queues` (Bull Board) is JWT-gated (ADMIN role required). In production, additionally restrict by IP at the reverse proxy or add HTTP Basic auth, or disable entirely if not needed.
- User-Agent reuse detection uses exact string matching. Browser updates can shift the UA mid-session (grace window expires in ~10s). Consider pre-hashing to UA-family before tightening further in prod.
- Existing-student redeem on `POST /invitations/redeem` accepts the student password as proof (public endpoint). Future hardening: gate this branch behind a JWT match if you want to require prior login.

**Known limitations:**
- Refresh-token rotation under simultaneous rotations from the same family has a documented (small) deadlock window. See `docs/architecture/auth-and-rbac.md` → "Known limitations".
- Password hash timing oracle on login failure paths (user-not-found vs password-mismatch). Mitigation: pre-hash at lookup boundary.

**Monitoring & observability:**
- Logs are structured JSON (when `LOG_PRETTY=false`). Wire to your log aggregation service (ELK, Datadog, Cloudwatch, etc.).
- Add OpenTelemetry instrumentation and forward to an APM (Jaeger, Datadog, New Relic) for distributed tracing.
- Set up alerting on 5xx errors and throttling events (429).

## Out of scope (future work)

- **Real payment integration** — Stripe or another processor. Purchase endpoint is idempotent; swap-in is straightforward.
- **Real email delivery** — SES, Sendgrid, Resend, etc. Swap transport behind `InvitationEmailProcessor` (5-attempt retry already wired).
- **Observability stack** — OpenTelemetry instrumentation and APM (Prometheus + Grafana, Datadog, New Relic, etc.).
- **Microservices split** — seams documented in ADR 0001; modular monolith is ready to partition.
