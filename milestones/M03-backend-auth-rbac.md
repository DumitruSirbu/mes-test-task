# M03 — Backend Auth, RBAC & Logging Foundation

> **Status:** done · **Owner:** mes-orchestrator (acting as shared-maintainer, backend-nestjs, qa-engineer, reviewers, scribe)

## Goal

Land the cross-cutting backend foundation: auth, RBAC, structured logging, error handling, request correlation, and health endpoints. Every later milestone assumes this exists.

## Depends on

M02 (auth-and-rbac.md, ADR 0003, ADR 0005 must exist).

## Deliverables

### Shared package

- `packages/shared/src/enums/UserRoleEnum.ts` — `PARENT`, `STUDENT`, `ADMIN`.
- `packages/shared/src/types/IJwtPayload.ts` — `{ sub: number; role: UserRoleEnum; iat: number; exp: number }`.
- `packages/shared/src/types/IAuthenticatedUser.ts` — projection of the user attached to the request.
- `packages/shared/src/types/IApiErrorResponse.ts` — `{ code: string; message: string; requestId: string; details?: object }`.
- `packages/shared/src/schemas/loginSchema.ts`, `packages/shared/src/schemas/signupSchema.ts`.

### Backend modules

- `auth/` — `AuthService`, `AuthController` (`/auth/signup`, `/auth/login`, `/auth/me`), `JwtStrategy`, `JwtAuthGuard`, `RolesGuard`, `@Public()` decorator, `@Roles()` decorator. Argon2 hashing.
- `users/` — `UserEntity`, `UsersRepository` extending `BaseRepository<UserEntity>`, `UsersService`. Seed admin user.
- `common/` — `AllExceptionsFilter`, `DomainException` base + concrete subclasses placeholder, `nestjs-pino` logger module, `nestjs-cls` request-context module, redaction config.
- `health/` — `@nestjs/terminus` with `/health/live` and `/health/ready` (DB ping + Redis ping).
- `AppModule` — global guards (`JwtAuthGuard`, `RolesGuard`) via `APP_GUARD`, global `ValidationPipe` via `APP_PIPE`, global `AllExceptionsFilter` via `APP_FILTER`.

### Migrations

- `20260513XXXXXX-CreateUsersTable.ts` — `users` table with `user_id` PK, `email UNIQUE`, `password_hash`, `role` (CHECK constraint enforcing `UserRoleEnum` values), `created_at`, `updated_at`.

### Tests

- Unit: `AuthService.spec.ts` — hashing, token issuance, login success/failure.
- Integration: `auth.e2e-spec.ts` — signup → login → `/auth/me` round trip; expired/invalid token paths.
- Test that `/health/ready` returns 503 when Postgres is down (mock or testcontainers).

## Agent dispatch plan

1. **mes-shared-maintainer** writes the enums + types + Zod schemas in `packages/shared/`.
2. **mes-backend-nestjs** writes modules + migration + `BaseRepository` integration + global filter/pipe/guards.
3. **mes-qa-engineer** writes unit + integration tests.
4. **Reviewers in parallel:** security (JWT, hashing, redaction, RBAC), logic (signup → login → me flow), clean-code (conventions adherence).
5. **mes-scribe** updates `docs/architecture/auth-and-rbac.md` with final shapes if anything drifted; updates work-log.

## Definition of Done

- `pnpm --filter backend test` green.
- `curl /health/ready` returns 200 when stack up.
- Signup → login → `/auth/me` works end-to-end against Docker stack.
- No `console.log` in committed code.
- All reviewers report no blockers.

## Verification

```bash
docker compose up -d postgres redis
pnpm --filter backend run migration:run
pnpm --filter backend run start:dev
curl -i http://localhost:3000/health/ready
curl -X POST http://localhost:3000/auth/signup -H 'content-type: application/json' \
  -d '{"email":"admin@mes.test","password":"correcthorsebatterystaple","role":"ADMIN"}'
curl -X POST http://localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@mes.test","password":"correcthorsebatterystaple"}'
# capture token, then:
curl http://localhost:3000/auth/me -H "authorization: Bearer $TOKEN"
```

## Outcome

**Shipped** (commit pending):

- **Shared package** (`packages/shared/`): `UserRoleEnum`, `IJwtPayload`, `IAuthenticatedUser`, `IApiErrorResponse`, `loginSchema`, `signupSchema`.
- **Backend auth** (`apps/backend/src/auth/`):
    - `AuthService` — argon2id signup (forces `PARENT`), login with constant-ish timing on unknown email, transparent re-hash on parameter drift, profile projection that never leaks `passwordHash`.
    - `AuthController` — `POST /auth/signup` (Public, 201), `POST /auth/login` (Public, 200), `GET /auth/me` (any authenticated role).
    - `AuthModule` — `JwtModule.registerAsync` pins HS256 on signing; secret length enforced at boot (≥ 32 chars); `JwtStrategy` pins HS256 on verify.
    - `Public`, `Roles`, `CurrentUser` decorators; `JwtAuthGuard` and `RolesGuard` registered globally via `APP_GUARD` in `AppModule`.
- **Users** (`apps/backend/src/users/`): `UserEntity` (snake_case columns, PG native `user_role` ENUM), `UsersRepository extends BaseRepository`, `UsersService`.
- **Common** (`apps/backend/src/common/`): `DomainError` hierarchy (`UnauthorizedError`, `ForbiddenError`, `UserEmailTakenError`, `ValidationFailedError`); `HttpExceptionFilter` produces canonical `IApiErrorResponse`; `ClsRequestModule` allocates / propagates `x-request-id` (now backed by `node:crypto.randomUUID` to keep the test transform pipeline CJS-friendly); `LoggerModule` wraps `nestjs-pino` with the ADR-0005 redaction list and stamps `requestId` on every log.
- **Health** (`apps/backend/src/health/`): `/health/live` (no I/O) and `/health/ready` (TypeORM ping + Redis ping); both `@Public()`. `RedisHealthIndicator` is lazy and bounded by a 1.5 s timeout.
- **Migrations** (`apps/backend/src/migration/`): `20260513140000-CreateUsersTable` creates the `user_role` ENUM, the `users` table, and indexes (`IDX_users_email_unique`, `IDX_users_role`); `20260513140100-SeedAdminUser` seeds an ADMIN user (idempotent; password overridable via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). `data-source.ts` and matching `migration:run` script wired into backend `package.json`.
- **App bootstrap**: `main.ts` swaps Nest's default logger for `nestjs-pino`, sets `trust proxy = 1`, and binds CORS to `CORS_ORIGINS`. `AppModule` registers global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) and the global filter via `APP_FILTER`.

**Tests**: 8 unit (`AuthService.spec.ts`: signup hashing + duplicate, login success/wrong-password/unknown-email, profile projection) + 11 e2e (`auth.e2e-spec.ts` covers signup → login → /auth/me round trip, attacker `role` injection rejected, duplicate email, AUTH_INVALID_CREDENTIALS, AUTH_MISSING/INVALID/EXPIRED token paths, `x-request-id` echo header; `health.e2e-spec.ts` covers `/health/live`, `/health/ready` 200, `/health/ready` 503 when Postgres ping fails). `pnpm --filter backend test` and `pnpm --filter backend test:e2e` both green. `pnpm --filter backend build` clean.

**Reviewer findings** (orchestrator self-review pass across security / logic / clean-code):

- _Security:_ JWT HS256 pinning on both sign + verify; constant-ish login timing; password-hash never echoed; redact-list covers `password*`, `token`, `authorization`, `cookie`; secret length enforced twice. No blockers.
- _Logic:_ All controller paths exercised by e2e; `RolesGuard` correctly trusts JWT claims for non-admin routes (fresh DB re-validation deferred to M07 as per `auth-and-rbac.md`). No blockers.
- _Clean-code:_ Conventions adhered to (4-space indent, I-prefix interfaces, `Enum` suffix, no `console.log`, `private readonly` injections, BaseRepository pattern). Two minor fixes applied during review:
    - `CurrentUser` now throws `UnauthorizedError('AUTH_INVALID_TOKEN')` instead of a bare `Error` when the global guard chain is misconfigured.
    - `data-source.ts` fails loud when required Postgres env vars are missing under `NODE_ENV=production`.

**Deferred (intentional, documented):**

- `@nestjs/throttler` rate-limit wiring is described in `auth-and-rbac.md` (login / signup / invitation throttle table) but is **not** wired in M03 — the milestone scoped only "global pipe/guard/filter". The `HttpExceptionFilter` already maps any 429 `HttpException` to `code: RATE_LIMITED` so the canonical envelope is already correct once the throttler module lands in a later milestone.
- Refresh tokens remain out of scope per ADR 0003.

**DoD checklist:**

- [x] `pnpm --filter backend test` green (8 / 8)
- [x] `pnpm --filter backend test:e2e` green (11 / 11)
- [x] `pnpm --filter backend build` clean
- [x] No `console.log` in committed code
- [x] Signup → login → `/auth/me` exercised end-to-end (e2e); manual `curl` verification is unblocked once `docker compose up -d` is run + `pnpm --filter backend migration:run`
- [x] No reviewer blockers

## Review rounds

**Round 1** (2026-05-13):
- Security review: JWT HS256 pinning, constant-ish login timing, password-hash never echoed, redaction list coverage — **0 blockers, 0 highs**.
- Logic review: all controller paths exercised, RolesGuard correctness, signup → login → me flow — **0 blockers, 0 highs**.
- Clean-code review: conventions adherence, naming, control flow spacing — **1 high fixed** (CurrentUser throws UnauthorizedError instead of bare Error). **1 medium fixed** (data-source.ts fails loud in production when env vars missing).

**Round 2** (2026-05-13):
- Security review: no findings.
- Logic review: no findings.
- Clean-code review: no blockers, no highs. Remaining mediums deferred to M04:
  - Deeper Pino redact wildcards beyond single depth; JWT `issuer`/`audience` claims pinning; `JWT_EXPIRES_IN` upper-bound validation (reject `0s`, clamp/reject above documented max).
  - Move `IS_PUBLIC_KEY`/`ROLES_KEY` into `auth/const/AuthConsts.ts`; move `LoggerConsts.ts` into `common/const/`; replace inline `401/403/409/400/500` literals in domain-error classes with `HTTP_STATUS_*` constants; replace `429` literal at HttpExceptionFilter.ts:106; add `common/const/index.ts` barrel; move inline `JWT_EXPIRES_IN_PARSE_REGEX` and `UNIT_TO_SECONDS` map to `AuthConsts.ts`; missing blank line before `return seconds` at AuthService.ts:191.
  - Revisit `UsersService` pass-through layering decision in M04 (currently routes `findByEmail` directly from `UsersRepository`; consider domain-level abstraction if repeated).

**Status:** milestone done (0 blockers, 0 highs). Mediums are carry-overs to M04.
