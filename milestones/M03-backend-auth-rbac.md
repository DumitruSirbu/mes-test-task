# M03 — Backend Auth, RBAC & Logging Foundation

> **Status:** pending · **Owner:** mes-orchestrator → mes-shared-maintainer → mes-backend-nestjs → mes-qa-engineer → reviewers → mes-scribe

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

(filled by mes-scribe at close)
