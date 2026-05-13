# Auth & RBAC

> Status: stub. Filled in M02 by `mes-architect`, implemented in M03.

## Roles (`UserRoleEnum`)

- `PARENT` — purchases, manages students under their account.
- `STUDENT` — accesses LMS, completes lessons.
- `ADMIN` — read-only operational view of the system.

## JWT shape (`IJwtPayload`)

```ts
{ sub: number; role: UserRoleEnum; iat: number; exp: number }
```

- Algorithm: HS256.
- Access token TTL: `JWT_EXPIRES_IN` (default 15m).
- Refresh strategy: TBD in M03 (decision in ADR 0003).

## Guard placement

- Global `JwtAuthGuard` registered via `APP_GUARD` in `AppModule`.
- Global `RolesGuard` registered after `JwtAuthGuard`.
- Public routes opt out with the `@Public()` decorator.
- Role-restricted routes use `@Roles(UserRoleEnum.PARENT, ...)`.

## Password hashing

- argon2id with default safe parameters from the library.

## See also

- `docs/architecture/adr/0003-jwt-stateless-auth.md`
- `docs/architecture/adr/0005-logging-and-error-handling.md`
