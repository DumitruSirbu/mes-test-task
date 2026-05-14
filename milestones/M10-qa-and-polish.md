# M10 — QA, Docker Finalisation & README

> **Status:** pending · **Owner:** mes-orchestrator → mes-devops → mes-qa-engineer → mes-scribe → reviewers

## Goal

Make `docker compose up` produce a fully working system from a clean clone, freeze the README, run a final security + clean-code pass, and capture AI-usage artefacts.

## Depends on

M01–M08.

## Deliverables

### Containerisation

- `apps/backend/Dockerfile` — multi-stage: builder runs `pnpm install` (with cache mount) + `pnpm --filter backend build`; runtime is `node:22-alpine` with only built artefacts, runs migrations on start, then `node dist/main.js`.
- `apps/web/Dockerfile` — builder: `pnpm --filter web build`; runtime: `nginx:alpine` serving `/usr/share/nginx/html` with SPA fallback.
- `apps/admin/Dockerfile` — same shape as web, different port.
- `docker-compose.yml` — full stack: `postgres`, `redis`, `backend` (with migration step on start), `web`, `admin`. Healthchecks. `depends_on: condition: service_healthy`. Backend exposes 3000; web 5173; admin 5174.
- Backend container's start command runs `pnpm run migration:run` before `start:prod`.
- `.env.example` updated with every variable consumed by every service.

### Tests final pass

- `pnpm --filter backend test` and `pnpm --filter backend test:e2e` green.
- `pnpm --filter web test` and `pnpm --filter admin test` green.
- Smoke test script in `scripts/smoke.sh` that hits health, signup, login, list courses.

### README

`mes-scribe` finalises `README.md` with all 12 sections per the contents checklist:
1. Project overview
2. Architecture overview (with mermaid diagram)
3. Tech stack table
4. Installation & run (`docker compose up`)
5. Environment variables table
6. Seeded credentials
7. End-to-end walkthrough
8. Key technical decisions (ADR summaries)
9. AI usage section linking `docs/ai-usage/`
10. Testing
11. Project structure
12. Next steps / out of scope

### AI-usage artefacts

- `docs/ai-usage/agents-team.md` — the team chart, model strategy table, skill wiring.
- `docs/ai-usage/orchestrator-dispatch-examples.md` — 2-3 short transcripts of the orchestrator dispatching specialists.
- `docs/ai-usage/diff-snippets.md` — selected diff hunks where AI produced exemplary code (link in README).
- Final row in `docs/work-log.md` totalling actual time vs the 3-4h budget.

## Agent dispatch plan

| Wave | Agents (dispatched in one message) | Runs after |
|------|-------------------------------------|------------|
| 1 | `mes-scribe` — log start time in work-log | — |
| 2 | `mes-devops` **∥** `mes-scribe` — Dockerfiles + compose + env wiring (devops); README + AI-usage docs (scribe, content already exists) | Wave 1 |
| 3 | `mes-qa-engineer` — `scripts/smoke.sh`, final `pnpm -r test` + `test:e2e` pass, verify containers healthy | Wave 2 (needs devops done) |
| 4 | `mes-review-security` **∥** `mes-review-logic` **∥** `mes-review-clean-code` — repo-wide final pass | Wave 3 |
| 5 | `mes-scribe` — close work-log with rolling total, mark M10 done | Wave 4 |

> Wave 2 is partially parallel: `mes-scribe` can draft the README and AI-usage docs without running containers; `mes-devops` builds the containers. `mes-qa-engineer` in Wave 3 must wait for `mes-devops` to finish so smoke tests can run against a full compose stack.

## Final reviewers pass

- Security: secrets scan; argon2; JWT; CORS; redaction; cross-tenant isolation.
- Logic: full evaluator walkthrough (parent → student → admin) executes cleanly.
- Clean-code: conventions adherence repo-wide, not just diff.

## Definition of Done

- Clean clone → `pnpm install` (optional) → `docker compose up` → browser walkthrough succeeds.
- README has all 12 sections, no TODOs.
- Work-log shows planning + every milestone with closed times; rolling total ≤ assignment budget or has a justified note.
- All reviewers report no blockers.

## Outcome

(filled by mes-scribe at close)
