# ADR 0003 — Stateless JWT Auth

> Status: draft. Finalised in M02 by `mes-architect`.

## Context

Need auth for parent/student/admin with RBAC, no separate auth provider.

## Decision

Stateless JWT (HS256), `JWT_SECRET` from env, access token TTL `15m` default. Refresh-token rotation is **out of scope for v1** (documented in README "Next steps") to stay within the time budget.

## Consequences

- ✅ Trivial to verify across requests; horizontally scalable.
- ⚠️ Compromised tokens are valid until expiry; mitigated by short TTL.
- ⚠️ Logout is client-side discard; "force logout" requires a revocation list (deferred).

## Alternatives considered

- **Session cookies with a server-side store.** Slightly safer revocation story; rejected because Redis is already in use for BullMQ and adding a session store stretches the budget.
- **OAuth provider (Clerk/Auth0).** Out of scope per the brief ("no real auth system required").
