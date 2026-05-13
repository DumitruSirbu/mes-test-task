# MES Test Task

A small full-stack app mocking the MES core journey: **Parent purchases → Student onboards → Student accesses the LMS**.

## How to work in this repo

**Every implementation task MUST start with `mes-orchestrator`.** Do not invoke specialist agents directly — the orchestrator decomposes the work, dispatches the right specialists, runs the reviewers (security / logic / clean-code), and triggers the scribe to update docs and the work log.

See the agent definitions in `.claude/agents/` (also accessible via `.agents/agents/` symlink).

## Hard rules

1. **Orchestrator first.** Never start by calling `mes-backend-nestjs`, `mes-frontend-react`, etc. directly.
2. **Read conventions before backend code.** `docs/best-practices/code-conventions.md` is MUST-FOLLOW for `apps/backend/`. It overrides the generic Clean Code defaults (I-prefix interfaces, Enum suffix, 4-space indent, etc.) where they conflict.
3. **Use `context7-mcp` before calling any third-party API.** Mandatory per the global rule in `~/.claude/CLAUDE.md`.
4. **Shared types live in `packages/shared/`.** Backend and frontend must NOT redefine enums/DTOs locally. Changes go through `mes-shared-maintainer` via the orchestrator.
5. **Run the reviewers on every change.** Security, logic, and clean-code reviewers run in parallel after implementation + QA.
6. **Update `docs/work-log.md`.** Every task gets a row with start/end times. The scribe owns this.

## Documentation map

- **Architecture overview** → `docs/architecture/overview.md`
- **Data model** → `docs/architecture/data-model.md`
- **Auth & RBAC** → `docs/architecture/auth-and-rbac.md`
- **Async jobs** → `docs/architecture/async-jobs.md`
- **ADRs** → `docs/architecture/adr/`
- **Features** → `docs/features/`
- **Code conventions (AUTHORITATIVE)** → `docs/best-practices/code-conventions.md`
- **Testing** → `docs/best-practices/testing.md`
- **Setup & dev** → `docs/development/setup.md`
- **Docker** → `docs/development/docker.md`
- **Work log** → `docs/work-log.md`
- **AI usage artefacts** → `docs/ai-usage/`

## Current milestone

→ `milestones/M03-backend-auth-rbac.md`

(M01 — Foundation: done. M02 — Architecture & ADRs: done.)

(The scribe keeps this pointer current.)

## Plan of record

`~/.claude/plans/so-ia-have-a-distributed-shell.md` — the full plan that defined this team and milestone structure. Source of truth for scope and rationale.
