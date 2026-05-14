# Feature — Auth Refresh Token Rotation (httpOnly Cookie)

> Status: shipped M09.

## Summary

Replaces the "access token only" model with a **short-lived access token (10 min, in-memory) + long-lived httpOnly refresh cookie (7 days, sliding)** pair. Users stay signed in across page reloads without exposing a long-lived credential to XSS. Resolves ADR 0003 follow-up and M07 cross-app note.

## What ships

### Access token
- Shape: HS256 JWT `{ sub, role, iat, exp }` (unchanged).
- **TTL:** 10 minutes (lowered from 15).
- Transport: JSON body on `POST /auth/login`, `POST /auth/signup`, `POST /auth/refresh`.
- Storage: in-memory only (React context/Zustand store).

### Refresh token
- Type: opaque random 256-bit token (`crypto.randomBytes(32).toString('base64url')`), **NOT a JWT**.
- TTL: 7 days, **sliding** — every successful refresh issues a new cookie with a fresh 7-day window.
- Transport: **httpOnly cookie**.
- Cookie name: `mes_rt` (constant `REFRESH_COOKIE_NAME` in `packages/shared`).
- **Attributes:** `httpOnly; Secure (prod only); SameSite=Lax; Path=/auth; Max-Age=604800`.
  - `Secure` flag is conditional on `NODE_ENV=production`.
  - `Lax` (not `Strict`) — preserves cross-site landing UX (e.g., user clicks invitation email → `/onboard` → first refresh succeeds).
  - `Path=/auth` is architectural: all cookie-bearing endpoints (`/auth/refresh`, `/auth/logout`) live under `/auth/*`.
  - `domain` attribute is NOT set (host-only).

### Storage

**`refresh_tokens` table** — per-token rows enabling reuse-detection and family revocation:

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL PK` | |
| `user_id` | `BIGINT FK NOT NULL` | |
| `family_id` | `UUID NOT NULL` | All tokens in a rotation chain share the same `family_id`. Revoke-all keys on this. |
| `token_hash` | `CHAR(64) NOT NULL UNIQUE` | SHA-256 hex of the raw token. **Must be UNIQUE** — double-inserts or collisions hard-fail. |
| `issued_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | TTL window calculated as `issued_at + 7 days`. |
| `revoked_at` | `TIMESTAMPTZ NULL` | Set by logout or theft-detected revocation. |
| `replaced_by_id` | `BIGINT NULL FK self` | Points to the new row after rotation. Used in grace-window detection. |
| `user_agent` | `TEXT NULL` | Stored for grace-window UA match. Redacted in logs (pino). |
| `ip` | `INET NULL` | Stored for forensics; IP matching dropped in grace window for mobile/CGNAT compat (v3). Redacted in logs. |

**Indexes:** `UNIQUE(token_hash)`, `(family_id)`, `(user_id, revoked_at)`.

### Rotation transactional flow

Every `POST /auth/refresh` call:

1. Begin transaction.
2. `SELECT … FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE` (lock the old row).
3. **Check branch:**
   - If `revoked_at IS NULL` (not revoked) and not expired → **happy path** (see below).
   - If `revoked_at IS NOT NULL` (already revoked) → **grace or theft path** (see below).
   - If expired → return 401 `REFRESH_TOKEN_EXPIRED`, no family revocation.
4. **Happy path:** INSERT new row (same `family_id`, fresh `expires_at = now() + 7d`, capture current `user_agent` and `ip`); UPDATE old row (`revoked_at = now()`, `replaced_by_id = <new.id>`); COMMIT.
5. **Only after commit succeeds**, write the `Set-Cookie` header with the new raw token.

This ordering ensures the cookie is never set if the DB transaction fails, maintaining consistency.

### Reuse-detection with grace window

When a token arrives that has already been rotated (`revoked_at IS NOT NULL`):

#### Grace path (legitimate retry, 10s window)
- **Condition:** `now() - revoked_at < 10 seconds` **AND** `user_agent` matches the original row AND `replaced_by_id IS NOT NULL`.
- **Action:** Re-issue the **successor token** verbatim (not a fresh rotation). The successor's `expires_at` is NOT refreshed — the response cookie's `Max-Age` is **recomputed** from `successor.expires_at - now()` (prevents sliding the family forward if attacker replays within the window).
- **Log signal:** None (legitimate behavior).
- **Implementation detail:** The successor's raw token is cached in-process with TTL = `REFRESH_REUSE_GRACE_SECONDS` (10s) to re-emit it verbatim. After the window expires, the cache entry drops and later replays fall through to theft.

#### Theft path (replay outside grace window, or mismatched UA)
- **Condition:** `now() - revoked_at >= 10 seconds` **OR** `user_agent` doesn't match.
- **Action:** `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL` (revoke entire family). Return 401 `REFRESH_TOKEN_REUSED`.
- **Log signal:** `logger.warn({ code: 'REFRESH_TOKEN_REUSED', userId, familyId, ipPrefix, uaMatch: false })` for security observability. (IP is /24 for v4, /64 for v6 — logged without full IP to enable forensics without storing PII in warn lines.)
- **Collateral damage:** The legitimate user's successor token is also revoked by the family-revocation update, so the victim is logged out too. Accepted trade-off: once the family is compromised, every token in it is suspect. The victim can re-log immediately; the attacker gains nothing.

**Design rationale (v3):** IP matching dropped in grace window for mobile/CGNAT compatibility (users flip IPs on Wi-Fi↔LTE, CGNAT shares IPs across thousands of devices). UA-only match is the chosen trade-off; false-positive logout rate is observable via the `REFRESH_TOKEN_REUSED` log signal.

### CSRF defense (layered)

#### Layer 1: `SameSite=Lax` cookie
Blocks cross-site POST by default.

#### Layer 2: Required header `X-Requested-With: XMLHttpRequest`
- Canonical value exposed as shared constant `XHR_REQUESTED_WITH` in `packages/shared`.
- Checked by `OriginAllowedGuard` on both `POST /auth/refresh` and `POST /auth/logout`.
- HTML forms cannot set custom headers — covers Lax's residual form-POST surface.

#### Layer 3: Server-side origin validation
- `OriginAllowedGuard` (in `apps/backend/src/common/guard/`) checks request `Origin` (or `Referer` fallback) against a CORS allow-list.
- **Hard-rejection rules (no implicit allow):**
  - `Origin: null` → 403 `REFRESH_CSRF_REJECTED` (sandboxed iframes, `file://`, redirect chains).
  - Both `Origin` **AND** `Referer` missing → 403 (never fall back to "absent ⇒ allowed").
  - `Origin` present but not in allow-list → 403.

#### Layer 4: CORS allow-list
- Switched from `*` to explicit list (env var `CORS_ALLOWED_ORIGINS`).
- `credentials: true` in `app.enableCors()`.
- Nest's CORS middleware uses function form to **echo** the matched origin (never `*` with credentials — browsers reject).

### Frontend integration

#### Boot dance (silent refresh on app load)
1. On app mount, call `/auth/refresh` (no bearer token; the cookie is the credential).
2. **On 401 → render `/login`** (failed to restore session).
3. **On success → fetch `/auth/me`** to hydrate `{ userId, role, email }` (access JWT carries no email — JWT size vs round-trip trade-off, see M09 Risks).
   - `/auth/me` failure (5xx / network blip) → drop access token + render `/login` (no partial hydration).
4. On success → store the new access token in-memory, render protected routes.

#### apiClient 401 handler
- **Trigger:** Only on `AUTH_TOKEN_EXPIRED` (401). Other 401 codes (`AUTH_INVALID_TOKEN`, `AUTH_FORBIDDEN_ROLE`) drop the token and route to `/login`, no retry.
- **Single-flight:** Concurrent token-expiry 401s share one in-flight refresh promise (prevent refresh storms).
- **Retry:** On refresh success, retry the original request **exactly once**, bypassing the 401 handler entirely (avoid recursion).
- **Recursion bound:** Any 401 on the retry (regardless of error code) drops the token and redirects to `/login`, never re-enters the refresh path (guaranteed no infinite loops under clock skew).

#### Logout race handling
- Set `authStore.isLoggingOut = true` **before** the `POST /auth/logout` network call.
- Fire the logout with short timeout (3s) and one automatic retry on network failure.
- In `finally`, clear in-memory store **and** clear the `isLoggingOut` flag.
- In-flight refresh promise's `.then()` checks `authStore.isLoggingOut` before hydrating; if set, drop the result (prevent resurrection if refresh resolves after logout).
- If logout network fails, the flag is still cleared — next login on the same tab hydrates normally.

#### sessionStorage removal
- **Fully removed** `AUTH_TOKEN_SESSION_STORAGE_KEY` (the bandaid from M07).
- **Also removed** `AUTH_SESSION_STORAGE_KEY` (user metadata key) — `{userId, role, email}` is now sourced from boot-time `/auth/me` call.
- No user data persists in browser storage → residual XSS-via-localStorage surface eliminated.

#### XSS hardening (in-memory store)
- Do NOT attach the auth store to `window` in production builds.
- Gate Zustand/Redux DevTools middleware on `import.meta.env.DEV` (close XSS-via-DevTools surface).

### Cleanup job

**BullMQ repeatable job** on the `maintenance` queue (named `refresh-token-cleanup`):
- **Schedule:** Daily at 03:00 UTC (`0 3 * * *` cron).
- **Action:** Delete two classes of rows:
  - `expires_at < now() - interval '7 days'` (TTL grace window, `REFRESH_TOKEN_GRACE_DAYS = 7`).
  - `revoked_at < now() - interval '30 days'` (forensic window, `REFRESH_TOKEN_FORENSIC_DAYS = 30`).
- **Logs:** `{ deletedExpired, deletedRevoked }` at info level.
- **Hard fallback assertion:** In the same job, run `SELECT count(*) FROM refresh_tokens WHERE revoked_at < now() - 60 days`. If count > 0, emit `logger.error({ code: 'REFRESH_TOKEN_RETENTION_BREACH' })` — catches the case where the cleanup job fails silently and PII columns (`user_agent`/`ip`) leak past the forensic window.

### Endpoints

#### `POST /auth/login`
- **Request:** `{ email, password }`
- **Response 200:** `{ accessToken, expiresIn }`
- **Set-Cookie:** `mes_rt=<raw>; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`

#### `POST /auth/signup`
- **Request:** `{ email, password, firstName?, lastName? }`
- **Response 201:** `{ accessToken, expiresIn }`
- **Set-Cookie:** Same as login.

#### `POST /auth/refresh`
- **Auth:** Public (`@Public()`), no bearer token required.
- **Guards:** `@UseGuards(OriginAllowedGuard)`, requires `X-Requested-With: XMLHttpRequest` header.
- **Cookie:** `mes_rt=<raw>` (from prior login/signup).
- **Response 200:** `{ accessToken, expiresIn }`
- **Set-Cookie:** New refresh cookie.
- **Throttle:** `THROTTLE_REFRESH_LIMIT = 30/min`, per-cookie-then-IP fallback (CGNAT-friendly, prevents CGNAT users sharing an outbound IP from all hitting the same limit).
- **Error codes:** `REFRESH_TOKEN_MISSING`, `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED`, `REFRESH_CSRF_REJECTED`.

#### `POST /auth/logout`
- **Auth:** Public, same guards as `/auth/refresh`.
- **Cookie:** `mes_rt=<raw>`
- **Response 204:** No content.
- **Set-Cookie:** Clear: `mes_rt=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0` (attribute parity with the issuing cookie — Safari requires exact match to clear).
- **Action:** Revoke the single token (not the whole family); idempotent (subsequent logouts do nothing).

## Error codes

| Code | HTTP | When |
|---|---|---|
| `REFRESH_TOKEN_MISSING` | 401 | `POST /auth/refresh` or `/auth/logout` without a `mes_rt` cookie. |
| `REFRESH_TOKEN_INVALID` | 401 | Cookie present but `token_hash` not found in DB (token never issued or already garbage-collected). |
| `REFRESH_TOKEN_EXPIRED` | 401 | Token found but `expires_at < now()`. No family revocation. |
| `REFRESH_TOKEN_REUSED` | 401 | Token revoked and replay detected outside 10s grace window or with mismatched UA. Entire family revoked. |
| `REFRESH_CSRF_REJECTED` | 403 | CSRF checks failed: missing `X-Requested-With` header, `Origin: null`, both `Origin` and `Referer` missing, or disallowed `Origin`. |
| `REFRESH_TOKEN_RETENTION_BREACH` | (logged, not HTTP) | Hard-fallback assertion in cleanup job: a row with `revoked_at` past 60 days still exists (cleanup job failed silently). |

## Logging & observability

- **Log redaction:** `pino` redacts `set-cookie`, `cookie`, `mes_rt`, `user_agent`, `ip` from all log lines (via config in `main.ts`).
- **Structured signals:** All error paths and state transitions emit `code:` field for monitoring:
  - `code: REFRESH_OK` — successful rotation or grace-path replay.
  - `code: REFRESH_TOKEN_EXPIRED` — token past TTL (no family revocation).
  - `code: REFRESH_TOKEN_REUSED` — theft detected (family revoked).
  - `code: REFRESH_TOKEN_RETENTION_BREACH` — cleanup hard-fallback triggered.
  - `code: REFRESH_CSRF_REJECTED` — CSRF validation failed.

## Architecture notes

- **Maintenance queue naming convention (ADR 0004 amendment):** Introduced the `maintenance` queue category for periodic housekeeping jobs that don't belong to domain workflows (naming pattern: `<domain>-cleanup`). First inhabitant: `refresh-token-cleanup` (M09). Future inhabitants: idempotency-key sweep (ADR 0006), expired invitation cleanup, etc.
- **Sequencing with M08:** M09 lands **after** M08. The cleanup job depends on BullMQ infrastructure (queue bootstrap, processor patterns) introduced in M08. Scaffolding from auth (Option B) would violate module boundaries and force M08 migration later.
- **Access token TTL trade-off:** Lowered from 15 → 10 minutes. Same security benefit, half the refresh chatter. Acceptably low per ADR 0003.
- **Route prefix load-bearing:** The `/auth/*` module prefix is now load-bearing — renaming it invalidates all live cookies (max-TTL 7 days). Architectural constraint documented for operational awareness.

## See also

- [ADR 0007 — Refresh Token Rotation (full design)](../architecture/adr/0007-refresh-token-rotation.md)
- [ADR 0003 amendment — Access token TTL change](../architecture/adr/0003-jwt-stateless-auth.md)
- [ADR 0006 amendment — Retry handler recursion bound](../architecture/adr/0006-retries-and-idempotency.md)
- [Auth & RBAC — Refresh token flows (sequence diagrams)](../architecture/auth-and-rbac.md#refresh-token-flows-adr-0007)
