# MES Test Task

A small full-stack app mocking the MES core journey: **Parent purchases → Student onboards → Student accesses the LMS**.

## Recommended model

Use **Claude Opus** for this repo. The main session acts as the orchestrator — decomposing work, dispatching agents, verifying results, and making judgment calls across specialists. Opus handles that coordination significantly better than Sonnet.

Switch model with `/model` in the CLI, or toggle Fast mode (Opus) with `/fast`.

## How to work in this repo

For every implementation task, the **main session acts as the orchestrator**: decompose the work, dispatch specialist agents in parallel where safe, run the three reviewers, trigger the scribe, and report a summary.

Specialist agents are defined in `.claude/agents/` (also accessible via `.agents/agents/` symlink). Dispatch them directly with the `Agent` tool — do not spawn `mes-orchestrator` as a subagent, since nested agent spawning is not supported at runtime (subagents cannot themselves call the `Agent` tool).

### Orchestration process

1. Read the milestone brief and decompose into backend / frontend / shared subtasks.
2. Dispatch independent specialists in parallel (`mes-backend-nestjs`, `mes-frontend-react`, `mes-shared-maintainer`, etc.).
3. After implementation lands, dispatch `mes-qa-engineer`.
4. Run the three reviewers in parallel: `mes-review-security`, `mes-review-logic`, `mes-review-clean-code`.
5. Dispatch `mes-scribe` to update docs and `docs/work-log.md`.

## Hard rules

1. **Follow the orchestration process above** for every non-trivial change. Do not skip reviewers or the scribe.
2. **Read conventions before backend code.** `docs/best-practices/code-conventions.md` is MUST-FOLLOW for `apps/backend/`. It overrides the generic Clean Code defaults (I-prefix interfaces, Enum suffix, 4-space indent, etc.) where they conflict.
3. **Use `context7-mcp` before calling any third-party API.** Mandatory per the global rule in `~/.claude/CLAUDE.md`.
4. **Shared types live in `packages/shared/`.** Backend and frontend must NOT redefine enums/DTOs locally. Changes go through `mes-shared-maintainer`.
5. **Run the reviewers on every change.** Security, logic, and clean-code reviewers run in parallel after implementation + QA.
6. **Update `docs/work-log.md`.** Every task gets a row with start/end times. The scribe owns this.

## Documentation map

- **Architecture overview** → `docs/architecture/overview.md`
- **Data model** → `docs/architecture/data-model.md`
- **Auth & RBAC** → `docs/architecture/auth-and-rbac.md`
- **Async jobs** → `docs/architecture/async-jobs.md`
- **ADRs** → `docs/architecture/adr/`
- **Features** → `docs/features/`
- **API reference** → `docs/api.md`
- **Code conventions (AUTHORITATIVE)** → `docs/best-practices/code-conventions.md`
- **Testing** → `docs/best-practices/testing.md`
- **Setup & dev** → `docs/development/setup.md`
- **Docker** → `docs/development/docker.md`
- **Work log** → `docs/work-log.md`
- **AI usage artefacts** → `docs/ai-usage/`

## Current milestone

→ `milestones/M07-admin-panel.md`

(M01 — Foundation: done. M02 — Architecture & ADRs: done. M03 — Backend Auth, RBAC & Logging: done. M04 — Purchase & Invitation: done. M05 — Student Onboarding & Activation: done. M06 — LMS Dashboard: done. M07 — Admin Panel: pending.)

(The scribe keeps this pointer current.)

## Plan of record

`~/.claude/plans/so-ia-have-a-distributed-shell.md` — the full plan that defined this team and milestone structure. Source of truth for scope and rationale.
