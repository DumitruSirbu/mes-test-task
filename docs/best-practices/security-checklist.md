# Security Checklist

Used by `mes-review-security` on every diff. Source of truth for the reviewer's scope.

## Auth

- [ ] `JWT_SECRET` read from env, never committed.
- [ ] Tokens have an `exp` claim.
- [ ] Algorithm explicit (`HS256` for v1).
- [ ] `argon2id` hashing for passwords.
- [ ] No password ever logged (redaction config covers it).

## RBAC

- [ ] Every endpoint has either `@Public()` or is gated by `JwtAuthGuard` + a `@Roles(...)` if role-restricted.
- [ ] No silent unauthenticated endpoints.
- [ ] Cross-tenant reads blocked at the service layer (parent A cannot read parent B's purchases).

## Input validation

- [ ] Every `@Body()` and `@Query()` has a DTO with `class-validator` decorators.
- [ ] Global `ValidationPipe` configured `whitelist: true, forbidNonWhitelisted: true, transform: true`.

## SQL & queries

- [ ] All queries via TypeORM or parameterised QueryBuilder.
- [ ] No string concatenation in queries.
- [ ] Raw queries only via `query(sql, params)`.

## Secrets

- [ ] `grep -rE '(password|secret|apikey|Bearer)' src/` returns nothing scary.
- [ ] No `.env` committed.

## Transport / CORS

- [ ] CORS allow-list from env (`CORS_ORIGINS`), not `*` in prod.
- [ ] Cookies (if used) `httpOnly`, `secure` in prod, `sameSite: 'lax'` minimum.

## Logging

- [ ] `pino` redact covers `password`, `token`, `authorization`, `jwt`.
- [ ] No `console.log` in committed code.
- [ ] Stack traces never in HTTP responses outside dev.

## Idempotency

- [ ] `Idempotency-Key` storage scoped per user (no cross-tenant replay).
- [ ] Replay returns the original response, not a re-execution.

## Rate limiting

- [ ] Note absence on `/auth/login` — flagged for follow-up.
