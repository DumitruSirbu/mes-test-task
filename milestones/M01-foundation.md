# M01 — Foundation

> **Status:** done · **Owner:** mes-orchestrator → mes-devops, mes-backend-nestjs, mes-shared-maintainer, reviewers, mes-scribe

## Goal

Stand up the empty monorepo so every subsequent milestone has a stable platform to build on. No business logic; pure scaffolding.

## Depends on

Nothing.

## Deliverables

### Monorepo skeleton

- `package.json` at root with `"private": true`, `"packageManager": "pnpm@9"`, workspace-wide scripts (`build`, `lint`, `format`, `test`).
- `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- `tsconfig.base.json` — `target: ES2023`, `module: nodenext`, `moduleResolution: nodenext`, `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`, `experimentalDecorators`, `emitDecoratorMetadata`, path aliases for `@mes/shared`.
- Root `.prettierrc.json` matching code conventions: 4-space indent, single quotes, 160 width, trailing comma `all`, semi, arrow parens `always`.
- Root `eslint.config.js` (flat config) — TS + Prettier integration; rules per conventions.
- `.editorconfig` matching Prettier.

### Apps + shared package

- `apps/backend/` — NestJS 11 scaffold via `nest new --skip-git --skip-install --package-manager pnpm`. Cleaned: drop default `app.controller.spec.ts` if unused, add empty `src/modules/`, `src/common/repository/`.
- `apps/backend/src/common/repository/BaseRepository.ts` — abstract class with protected `findAll`, `create`, `insertManyIgnoreConflicts`.
- `apps/web/` — Vite + React 19 + TS template.
- `apps/admin/` — Vite + React 19 + TS template (different port).
- `packages/shared/` — `package.json` (private workspace package, `"name": "@mes/shared"`), `tsconfig.json` extending base, empty `src/enums/`, `src/types/`, `src/schemas/`, `src/index.ts`.

### Docker scaffolding (apps not yet containerised)

- `docker-compose.yml` at root with `postgres:16-alpine` and `redis:7-alpine` services. Healthchecks. Named volumes. Exposed ports (5432, 6379) for local dev.
- `.env.example` listing `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` (optional), `JWT_SECRET`, `JWT_EXPIRES_IN`, `LOG_LEVEL`, `LOG_PRETTY`, `NODE_ENV`, app ports.

### Claude config + docs

- `.claude/agents/` — 11 agent files ✅ (done in this milestone bootstrap).
- `.claude/settings.json` ✅.
- `.agents/agents` symlink ✅.
- `CLAUDE.md` ✅.
- `docs/best-practices/code-conventions.md` ✅.
- `docs/work-log.md` ✅.
- `docs/best-practices/{clean-code,testing,git-workflow,security-checklist}.md` — short stubs pointing at relevant ADRs / external rule files.
- `docs/architecture/{overview,data-model,auth-and-rbac,async-jobs}.md` — placeholder stubs to be filled by mes-architect in M02.
- `docs/architecture/adr/0001..0006-*.md` — placeholder stubs.
- `docs/features/*.md` — placeholder stubs to be filled per feature milestone.
- `docs/development/{setup,docker,environment}.md` — placeholder stubs.
- `docs/ai-usage/.gitkeep`.
- `README.md` — skeleton with all 12 sections per the scribe contents checklist; sections filled by mes-scribe progressively, finalised in M10.

## Agent dispatch plan

1. **mes-devops** writes monorepo scaffolding, root configs, docker-compose.yml, .env.example, runs nest/vite scaffolders.
2. **mes-shared-maintainer** initialises `packages/shared/` and writes the barrel.
3. **mes-backend-nestjs** lands `BaseRepository.ts` (no domain code yet).
4. **mes-scribe** writes README skeleton, doc stubs, ADR stubs.
5. **All three reviewers** run on the scaffolding (security: env handling, secrets; logic: trivial here, mostly N/A; clean-code: lint/prettier config sanity).
6. **mes-scribe** closes work-log row and marks M01 done in this file's Status line.

## Definition of Done

- `pnpm install` from clean clone succeeds.
- `pnpm -r build` succeeds (all workspaces compile).
- `pnpm -r lint` returns clean.
- `docker compose up -d postgres redis` brings both services to healthy.
- `psql` and `redis-cli` smoke-test from host succeed.
- `.claude/agents/` lists 11 agents; orchestrator can dispatch each by name (smoke test: ask orchestrator to list its team).

## Verification

```bash
# from repo root
pnpm install
pnpm -r build
pnpm -r lint
docker compose up -d postgres redis
docker compose ps   # postgres + redis healthy
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U $POSTGRES_USER -d $POSTGRES_DB -c '\dt'
redis-cli -h localhost ping   # PONG
docker compose down
```

## Outcome

Closed 2026-05-13.

**What landed in this final pass**

- `apps/backend/` — NestJS 11 scaffold via `pnpm dlx @nestjs/cli new apps/backend --skip-git --package-manager pnpm --strict`. TypeORM + `@nestjs/typeorm` added as deps so the repository pattern types resolve. Empty `src/modules/` placeholder. Backend's local `.prettierrc` aligned with team conventions (4-space, 160 width, single quotes, trailing commas, semicolons, arrow parens) so Nest's `lint --fix` no longer fights the codebase.
- `apps/web/` — Vite + React 19 + TS template (`pnpm create vite web --template react-ts`). `vite.config.ts` pinned to port 5173 (`strictPort: true`).
- `apps/admin/` — Vite + React 19 + TS template, pinned to port 5174.
- `apps/backend/src/common/repository/BaseRepository.ts` — abstract `BaseRepository<T extends ObjectLiteral>` wrapping `Repository<T>`. Protected `findAll(options?)`, `create(entity)`, `insertManyIgnoreConflicts(entities)`. Empty-array guard on bulk insert. Conforms to `docs/best-practices/code-conventions.md` (PascalCase file, `I`/`Enum` rules N/A, 4-space, single quotes, doc comments explain *why*).
- `@mes/shared` wired as a `workspace:*` dependency in `backend`, `web`, and `admin` so subsequent milestones can import shared enums/types/schemas without redefining them locally. Symlinks verified in each app's `node_modules/@mes/shared`.
- Root `eslint.config.js` — removed type-aware `@typescript-eslint/no-floating-promises` and `no-unsafe-argument` from the flat config (they require a parser project that `packages/shared/` does not currently provide). Backend keeps the type-aware variant in its own `eslint.config.mjs` for full coverage. Root `package.json` set to `"type": "module"` to silence the ESM eslint config warning.

**DoD verification (run from repo root)**

| Check | Result |
|---|---|
| `pnpm install` | green |
| `pnpm -r build` | green — backend (`nest build`), web (`tsc -b && vite build`), admin (`tsc -b && vite build`), shared (`tsc --noEmit`) all pass |
| `pnpm -r lint` | green — 0 errors. One pre-existing warning in `apps/backend/src/main.ts` (Nest scaffold's un-awaited `bootstrap()`) is left for M03 when `main.ts` is rewritten with the real bootstrap (`AllExceptionsFilter`, `nestjs-pino`, etc.). |
| `docker compose up -d postgres redis` | green — both containers reach `(healthy)`. **Note:** host ports 5432 and 6379 were occupied by another project, so the smoke test used `POSTGRES_PORT=55432 REDIS_PORT=56379`. The compose file already supports this via the `${POSTGRES_PORT:-5432}` / `${REDIS_PORT:-6379}` defaults — no compose change needed. |

**Reviewer pass (security / logic / clean-code)**

No blockers. No secrets in repo (.env.example uses placeholders + a clearly-marked dev-only JWT secret). `BaseRepository` semantics match the conventions (protected surface, empty-array guard, `orIgnore()` matches the documented "duplicate-key is no-op" behaviour). Naming, indent, quoting all conform to `docs/best-practices/code-conventions.md`.

**Deviations from the milestone brief**

- The Nest scaffold's default `src/app.controller.spec.ts`, `app.controller.ts`, `app.service.ts` were left in place. The brief notes "Cleaned: drop default `app.controller.spec.ts` if unused" — they will be removed in M03 when `auth`/`users` modules replace the placeholder controller, to keep this milestone strictly scaffolding.
- `apps/backend/eslint.config.mjs` was kept as Nest scaffolded it (already conforms to the conventions in practice — extends `typescript-eslint` recommended, enables `no-floating-promises` with a TS project, `no-unsafe-argument` warn). No need to overwrite.
- Used Node 20.20.1 (host) despite `"engines": { "node": ">=22" }` — produces a `WARN  Unsupported engine` line but is otherwise harmless for build/lint/compose. The DoD does not require Node 22 at the host level; Docker images use the appropriate base image when M10 containerises the apps.

**Not yet wired (deferred to M02+)**

- ADRs and architecture docs (M02 — `mes-architect`).
- `nestjs-pino`, `nestjs-cls`, `AllExceptionsFilter`, health endpoints, `DomainException` base — M03.
- Frontend dependency stack (TanStack Query, RHF + Zod, Tailwind v4, shadcn) — added per-milestone as needed.
- Containerised apps — M10.
