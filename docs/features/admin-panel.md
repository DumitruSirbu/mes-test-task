# Feature — Admin Panel

> Status: shipped M07, polished M07 Wave 8.

## Scope

Read-only views for the seeded ADMIN account:

- `/parents` — paginated list.
- `/students` — paginated list with linking back to parent.
- `/purchases` — paginated list, newest first, includes idempotency-key replay count.
- `/courses` — catalog inspection.

Served from `apps/admin/` on its own port. Same auth backend as `apps/web`. Login refuses non-ADMIN roles.

## RBAC

- Every `admin/*` endpoint requires `@Roles(ADMIN)`.
- Frontend route guard rejects non-ADMIN tokens with a clear "ADMIN access only" page.
- Proxy-aware throttler on login (keys by user.id / X-Forwarded-For / IP).
- Session cleared on 401; validation errors mapped to canonical envelope.

## Non-goals (v1)

- Mutating data from the admin panel.
- Impersonation.
- Full audit log.
- XSS/localStorage hardening (cross-app; M09 scope).
- Rate limiting on other endpoints (cross-app; M09 scope).
