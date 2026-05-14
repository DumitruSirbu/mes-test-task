# M09 — Refresh Token Rotation (httpOnly cookie)

> **Status:** pending · **Owner:** mes-orchestrator → mes-architect → mes-shared-maintainer → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe
> **Revision:** v3 — incorporates v2 re-review findings (Origin guard hardening, grace-window mobile/CGNAT relaxation, sequencing commit, logout-flag lifecycle, ADR 0006 recursion bound, ADR 0004 maintenance-queue amendment, etc.). See "Review notes incorporated (v3)" at bottom.

## Goal

Replace the "in-memory access token only" model with a **short-lived access token (in JS memory) + long-lived refresh token (httpOnly cookie)** pair, so users stay signed in across page reloads without exposing a long-lived credential to JS/XSS. Resolves the explicit "Next steps" item in ADR 0003 and the cross-app follow-up logged at the end of M07.

## Depends on

- M03 (auth + JWT issuing pipeline exists).
- M07 (admin SPA + parent SPA both consume `/auth/login`; both must be migrated).

## Non-goals

- No third-party identity provider.
- No password reset / email verification flow.
- No device management UI ("see active sessions") — the `refresh_tokens` table makes it trivial later, but the UI is out of scope.
- No migration of existing access-token-only sessions — users will have to log in once after deploy.
- No `kid`-based JWT key rotation (deferred to a future ADR per ADR 0003 §"Rotation procedure").

## Threat model addressed

| Threat | Current (M03) | After M09 |
|--------|---------------|-----------|
| XSS exfiltrates long-lived credential | N/A — only 15-min access token in memory | Refresh token in httpOnly cookie, unreachable from JS |
| Page reload forces re-login | Yes (UX problem) | No — silent refresh on boot |
| Stolen refresh token replayed | N/A | Detected via reuse-detection → entire family revoked (with grace window for legitimate retries) |
| CSRF on refresh endpoint | N/A — no cookies | Mitigated via `SameSite=Lax` + `X-Requested-With` header check + server-side `Origin`/`Referer` allow-list |
| Refresh token theft via log leak | N/A | `pino` redacts `set-cookie`, `cookie`, `mes_rt`, `user_agent`, `ip` |
| Server-side logout impossible | Yes (acknowledged trade-off) | Yes — refresh token revoked in DB on `/auth/logout` |
| Reuse-detection false positive on legit network retry | N/A | 10s grace window with IP/UA match (see §6) |

## Architecture decisions (ADR 0007 + amendments)

### ADR 0007 (new) — refresh token transport, storage, rotation

1. **Access token:** unchanged shape (HS256 JWT, `{ sub, role, iat, exp }`). **TTL lowered from 15 → 10 minutes** (revised from initial 5min after architect review — same security benefit, half the refresh chatter). Returned in JSON body. Kept in JS memory only.
2. **Refresh token:** opaque random 256-bit token (`crypto.randomBytes(32).toString('base64url')`). NOT a JWT. **TTL: 7 days, sliding** — every successful refresh issues a new one with a fresh 7-day window.
3. **Cookie attributes:** `httpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=604800`. `Secure` is conditional on `NODE_ENV=production`. **Lax (not Strict)** — combined with the header + Origin checks below it has equivalent CSRF posture without breaking the cross-site landing case (e.g. user clicks invitation email → `/onboard` → first refresh would otherwise lose the cookie under Strict).
4. **Cookie domain & topology:** host-only on the API origin (no `Domain` attribute set). `Path=/auth` is acceptable because all cookie-bearing endpoints (`/auth/refresh`, `/auth/logout`) live under that prefix. **Architectural constraint:** the `auth` route prefix is now load-bearing — renaming the module invalidates all live cookies.
5. **Storage:** `refresh_tokens` table:
   - `id BIGSERIAL PK`
   - `user_id BIGINT FK NOT NULL`
   - `family_id UUID NOT NULL`
   - `token_hash CHAR(64) NOT NULL` (SHA-256 hex of the raw token; **`UNIQUE`** — collisions or double-inserts must hard-fail)
   - `issued_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `expires_at TIMESTAMPTZ NOT NULL`
   - `revoked_at TIMESTAMPTZ NULL`
   - `replaced_by_id BIGINT NULL FK self`
   - `user_agent TEXT NULL`
   - `ip INET NULL`
   - Indexes: `UNIQUE(token_hash)`, `(family_id)`, `(user_id, revoked_at)`.
6. **Rotation:** wrapped in a single DB transaction with `SELECT … FOR UPDATE` on the old row.
   - Insert new row (same `family_id`).
   - Mark old `revoked_at = now()`, `replaced_by_id = <new>`.
   - Commit.
   - Only after commit: write the `Set-Cookie` header.
7. **Reuse-detection with grace window** (v2: security/logic MAJOR fix; v3: mobile/CGNAT relaxation):
   - If `/auth/refresh` arrives carrying a token whose `revoked_at IS NOT NULL`:
     - **Grace path:** if `replaced_by_id IS NOT NULL` AND `now() - revoked_at < REFRESH_REUSE_GRACE_SECONDS` (default 10s) AND `user_agent` matches the original row → treat as legitimate retry: re-issue the *successor* token verbatim. **The successor's `expires_at` is NOT refreshed**; the response cookie's `Max-Age` is recomputed from `successor.expires_at - now()`. This prevents an attacker replaying within the window from sliding the family forward.
     - **IP matching is intentionally dropped** in v3: mobile clients flip IPs on Wi-Fi↔LTE handoff, CGNAT users share IPs across thousands of devices. UA-only match is the chosen trade-off; the false-positive logout rate is observable via the `code: REFRESH_TOKEN_REUSED` log signal.
     - **Theft path:** otherwise → `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL` and emit `logger.warn({ code: 'REFRESH_TOKEN_REUSED', userId, familyId, ipPrefix, uaMatch })` for security observability. Return 401 `REFRESH_TOKEN_REUSED`. (`ipPrefix` = `/24` for v4, `/64` for v6 — useful for forensics without storing the full IP in the warn line.)
8. **CORS:** allow-list switches from `*` → explicit list (already configurable via `CORS_ALLOWED_ORIGINS`). `credentials: true`. Use the function form of Nest's CORS config to **echo** the matched origin (never `*` with credentials — browsers reject).
9. **CSRF defense (layered):**
   - `SameSite=Lax` cookie (blocks cross-site POST).
   - Required header `X-Requested-With: XMLHttpRequest` on `/auth/refresh` and `/auth/logout` (canonical value, exposed as shared constant `XHR_REQUESTED_WITH`). Forms cannot set this header — covers Lax's residual cross-site form-POST surface.
   - Server-side `Origin` (or `Referer` fallback) must match the CORS allow-list. Implemented as a small guard `OriginAllowedGuard` (placed in `common/guard/`, not `auth/guard/`, since it is a CORS concern reusable beyond auth).
   - **Hard rejection rules (no implicit allow):**
     - `Origin: null` → 403 `REFRESH_CSRF_REJECTED` (covers sandboxed iframes, `file://`, redirect chains).
     - Both `Origin` AND `Referer` missing → 403 `REFRESH_CSRF_REJECTED`. Never fall back to "absent ⇒ allowed".
     - `Origin` present and not in allow-list → 403, regardless of `Referer`.
   - E2E asserts each rejection path explicitly.
10. **Algorithm pinning, secret length, error code mapping** from ADR 0003 unchanged. ADR 0007 re-states the algorithm pin.
11. **Cleanup:** modeled as a **BullMQ repeatable job** on a new `maintenance` queue (`refresh-token-cleanup` job, `RefreshTokenCleanupProcessor`), per ADR 0004's "BullMQ for all async work" stance. Runs daily at 03:00 UTC. Two delete clauses:
    - `expires_at < now() - interval '7 days'` (TTL grace window — `REFRESH_TOKEN_GRACE_DAYS = 7`).
    - `revoked_at < now() - interval '30 days'` (forensic window — `REFRESH_TOKEN_FORENSIC_DAYS = 30`).
    Logs `{ deletedExpired, deletedRevoked }`. **Hard SQL fallback assertion** runs in the same job: `SELECT count(*) WHERE revoked_at < now() - 60 days` → if > 0, emit `logger.error({ code: 'REFRESH_TOKEN_RETENTION_BREACH' })` (catches the case where the cleanup job fails silently and PII columns `user_agent`/`ip` retain past the forensic window).
    See "Sequencing with M08" — **v3 commits to Option A (land M09 after M08)**.

### ADR 0003 amendment

Header note: "Superseded in part by ADR 0007 (refresh token rotation, access TTL 15→10min). Original rationale preserved below." Back-link to ADR 0007. Original body untouched.

### ADR 0006 amendment (v2 logic MAJOR + v3 recursion bound)

Header note: "Amended by ADR 0007 §`apiClient` retry rule." The "no retry on 401" rule changes to:
> On `AUTH_TOKEN_EXPIRED` (401) — attempt one silent refresh; on success, retry the original request **exactly once**. **The retried request bypasses the 401 handler entirely** — any 401 on the retry (regardless of error code) drops the token and redirects to `/login`, never re-enters the refresh path. On `AUTH_INVALID_TOKEN`, `AUTH_FORBIDDEN_ROLE`, or refresh failure → drop token, redirect to `/login`. **Never retry on any other 4xx.** This guarantees no recursion under clock skew or pathological backend states.

### ADR 0005 amendment

Add to the canonical error-code table: `REFRESH_TOKEN_MISSING`, `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED`, `REFRESH_CSRF_REJECTED`, `REFRESH_TOKEN_RETENTION_BREACH`. Add `set-cookie`, `cookie`, `mes_rt`, `user_agent`, `ip` to the `pino` redact paths. **Observability deliverables** in M09 are downgraded from "metrics counters" to "structured log fields with stable `code` values" — the project has no metrics pipeline today; a future observability ADR can promote them to counters.

### ADR 0004 amendment (v3 architect MAJOR fix)

Header note: "Amended by ADR 0007 §11 — introduces the `maintenance` queue category." Add to the queue inventory:
> **`maintenance`** — periodic-sweep queue for housekeeping jobs that don't belong to a domain workflow. Naming convention: `<domain>-cleanup` (e.g. `refresh-token-cleanup`). Jobs are BullMQ repeatable (cron-style); failure alerting via `logger.error` with stable `code:` field. First inhabitant: `refresh-token-cleanup` (M09). Future inhabitants: idempotency-key sweep (per ADR 0006), expired invitation cleanup, etc. — all live here, not in domain queues.

### Sequencing with M08 (v3: committed)

**M09 lands after M08.** No conditional. The cleanup job depends on BullMQ infrastructure introduced in M08; scaffolding it from inside an auth milestone (Option B in v2) would force queue bootstrap into `auth/job/`, violating module boundaries and creating a parallel pattern M08 would have to migrate. If scheduling truly forces M09 first, the maintenance-queue bootstrap MUST live in a neutral `infra/queues/` module — flagged at dispatch as a scope expansion that requires separate review.

## Deliverables

### Architecture

- `docs/architecture/adr/0007-refresh-token-rotation.md` — full design per above.
- `docs/architecture/adr/0003-jwt-stateless-auth.md` — header amendment + back-link.
- `docs/architecture/adr/0005-logging-and-error-handling.md` — error-code table additions, redact-path additions.
- `docs/architecture/adr/0006-retries-and-idempotency.md` — header amendment for the 401 retry rule.
- `docs/architecture/auth-and-rbac.md` — sequence diagrams for login, refresh (rotation + grace), logout, reuse-detection (theft path).

### Shared package

- `packages/shared/src/types/IAuthTokenResponse.ts` — already exists; **shape unchanged**. Refresh token is NOT in the JSON body.
- `packages/shared/src/const/AuthCookieConsts.ts` — `REFRESH_COOKIE_NAME = 'mes_rt'`, `REFRESH_COOKIE_PATH = '/auth'`, `XHR_REQUESTED_WITH = 'XMLHttpRequest'`.
- `packages/shared/src/types/IRefreshErrorCode.ts` — `REFRESH_TOKEN_MISSING | REFRESH_TOKEN_INVALID | REFRESH_TOKEN_REUSED | REFRESH_TOKEN_EXPIRED | REFRESH_CSRF_REJECTED`.

### Backend

- **Migration** `<ts>-CreateRefreshTokensTable.ts` — table + indexes per §5 above (including `UNIQUE(token_hash)`).
- **Entity + repository** `RefreshTokensRepository` (in `auth/repository/`).
- **`OriginAllowedGuard`** (`common/guard/` — moved out of `auth/` since it's a CORS concern reusable beyond auth) — checks `Origin`/`Referer` against the CORS allow-list with the hard-rejection rules in §9.
- **Service changes** in `AuthService`:
  - `login()` and `signup()` — additionally issue a refresh token, return both access JWT (body) and refresh cookie (response header).
  - `refresh(rawToken, requestMeta)` — transactional rotation per §6; reuse-detection per §7. Decide retry-vs-theft using `REFRESH_REUSE_GRACE_SECONDS`.
  - `logout(rawToken)` — revoke that single token (not the whole family). Idempotent.
- **New endpoints** on `AuthController`:
  - `POST /auth/refresh` — `@Public()`, `@UseGuards(OriginAllowedGuard)`, requires `X-Requested-With` header (validated via guard), throttled (`THROTTLE_REFRESH_LIMIT = 30/min`).
  - `POST /auth/logout` — same guards as above (cookie auth, not bearer).
- **Cookie clear on logout:** `Set-Cookie: mes_rt=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax` — all attributes identical to the issuing cookie. Asserted in e2e.
- **Cookie handling:** check via context7 whether Nest's default Express adapter exposes `request.cookies` natively; install `cookie-parser` only if not. Set/clear cookie via `@Res({ passthrough: true })` in the controller (keep service framework-agnostic).
- **Bootstrap** `apps/backend/src/main.ts` — `app.enableCors({ credentials: true, origin: <fn allow-list> })`.
- **Constants** `AuthConsts.ts`:
  - `JWT_EXPIRES_IN` default `'10m'` (was `'15m'`)
  - `REFRESH_TOKEN_TTL_DAYS = 7`
  - `REFRESH_TOKEN_BYTES = 32`
  - `REFRESH_REUSE_GRACE_SECONDS = 10`
  - `REFRESH_TOKEN_GRACE_DAYS = 7`
  - `REFRESH_TOKEN_FORENSIC_DAYS = 30`
  - `THROTTLE_REFRESH_LIMIT = 30` (per-cookie when present, falling back to per-IP — avoids punishing CGNAT users who share an outbound IP)
- **Cleanup processor** `auth/job/RefreshTokenCleanupProcessor.ts` — BullMQ repeatable job on `maintenance` queue, schedule `0 3 * * *`. Logs `{ deletedExpired, deletedRevoked }`.
- **Metrics / log signals:**
  - Refresh success counter / failure counter (by error code).
  - Family-revocation counter (security signal).
  - Cleanup-job rows-deleted counter.

### Frontend (`apps/admin/` and `apps/web/`)

- **`apiClient`** — `credentials: 'include'` on all requests. Always send `X-Requested-With: XMLHttpRequest`. 401 handler:
  - **Trigger only on `AUTH_TOKEN_EXPIRED`.** Other 401 codes (`AUTH_INVALID_TOKEN`, `AUTH_FORBIDDEN_ROLE`) → drop + redirect, no retry.
  - Single-flight: concurrent expirations share one in-flight refresh promise.
  - On refresh success → retry the original request **once**.
  - On refresh failure → drop + redirect.
- **App boot:**
  1. Call `/auth/refresh`. On 401 → render `/login`.
  2. On success, hydrate auth store with the new access token.
  3. Call `/auth/me` to repopulate `{ userId, role, email }` (the access JWT carries no email — see Risks for the round-trip-vs-JWT-bloat trade-off).
  4. **`/auth/me` failure path** (network blip, 5xx) → drop access token + render `/login`. Treated as a cold-start failure; do NOT retry, do NOT leave a partially-hydrated store.
- **Logout flow** (concrete lifecycle for the in-flight-refresh race):
  1. Set `authStore.isLoggingOut = true` *before* the network call.
  2. `POST /auth/logout` with a short timeout (e.g. 3s); retry once on network failure.
  3. In `finally`, clear in-memory store **and** clear the `isLoggingOut` flag.
  4. The single-flight refresh promise's `.then()` handler checks `authStore.isLoggingOut` before hydrating; if set, drop the result.
  5. The 401-retry chain checks `authStore.accessToken` before retrying; if empty, short-circuit.
  6. **App-boot recovery:** if on boot the auth store is empty BUT the cookie is still present (silent refresh succeeds), the user is implicitly logged back in — this is correct behavior. The "logged out but cookie still there" pathological case is bounded by the natural cookie TTL.
- **sessionStorage cleanup (admin SPA):**
  - Remove `AUTH_TOKEN_SESSION_STORAGE_KEY` (the bandaid added during the M07 follow-up).
  - **Also remove `AUTH_SESSION_STORAGE_KEY`** (the user-metadata key) — `{userId, role, email}` is now sourced from the boot-time `/auth/me` call. No user data persists in browser storage.
- **`apps/web/` boot path** — currently hydrates from sessionStorage; M09 introduces a **new** boot dependency: silent refresh + follow-up `/auth/me`. This is a refactor, not a tweak — call it out at backend handoff.
- **In-memory store XSS hardening** — do NOT attach the auth store to `window` in production builds. Gate Zustand/Redux DevTools middleware (or any store-inspection wiring) on `import.meta.env.DEV`. This closes the residual XSS-via-DevTools surface that remains after sessionStorage removal.

### Tests

**Backend:**
- Unit: refresh token hashing (raw never logged, hash deterministic, `UNIQUE` constraint enforced).
- Unit: rotation issues a new token with same `family_id`, marks old as revoked + `replaced_by_id` set, runs in a single transaction (rollback on insert failure leaves old token still valid).
- Unit: reuse-detection theft path — replaying a revoked token outside the grace window → entire family revoked, `REFRESH_TOKEN_REUSED` logged, 401 returned.
- Unit: reuse-detection grace path — replaying a revoked token within `REFRESH_REUSE_GRACE_SECONDS` with matching IP/UA → returns the successor token, family intact.
- Unit: reuse-detection grace path with mismatched IP → treated as theft.
- Unit: expired token → 401 `REFRESH_TOKEN_EXPIRED`, no family revocation.
- Unit: cleanup processor — removes only tokens past TTL grace AND revoked-forensic windows.
- Unit: signup vs login refresh paths produce identical token shape + cookie attributes.
- E2E: `POST /auth/login` sets cookie + returns access token. Cookie attributes asserted (`HttpOnly`, `Secure` flag in prod-like env, `SameSite=Lax`, `Path=/auth`, `Max-Age=604800`).
- E2E: `POST /auth/refresh` with valid cookie returns new access token + new cookie (different value, same family).
- E2E: `POST /auth/refresh` without cookie → 401 `REFRESH_TOKEN_MISSING`.
- E2E: `POST /auth/refresh` without `X-Requested-With` → 403 `REFRESH_CSRF_REJECTED`.
- E2E: `POST /auth/refresh` with `Origin: null` → 403 `REFRESH_CSRF_REJECTED`.
- E2E: `POST /auth/refresh` with both `Origin` and `Referer` missing → 403 `REFRESH_CSRF_REJECTED`.
- E2E: cross-origin `<form>` POST to `/auth/refresh` (no `X-Requested-With`) → 403 (defense-in-depth verification that header check holds even if Lax ever regresses).
- E2E: `POST /auth/refresh` with disallowed `Origin` → 403 `REFRESH_CSRF_REJECTED`.
- E2E: `POST /auth/logout` clears cookie (attribute parity asserted); subsequent refresh → 401.
- E2E: replay attack — refresh once; with the *original* token replayed after grace window → 401, *and* the rotated successor token also returns 401 on next use (family dead).
- E2E: replay within grace window with matching UA → returns the same successor as the first refresh, family intact, **successor `expires_at` unchanged**, response cookie `Max-Age` recomputed correctly.
- E2E: replay within grace window with mismatched UA → treated as theft (family revoked).
- E2E: two concurrent logins from two tabs → distinct `family_id`; revoking one family does not affect the other.
- E2E: tab-1 logs in, tab-2 logs in (tab-2's `Set-Cookie` overwrites tab-1's), tab-1 then triggers a silent refresh → uses tab-2's family, succeeds, **no `REFRESH_TOKEN_REUSED` warn line emitted**. Tab-1's orphaned family is later swept by the cleanup job at TTL.
- E2E: cleanup job hard-fallback assertion — manually insert a row with `revoked_at = now() - 70 days` (past forensic window), trigger job, assert `code: REFRESH_TOKEN_RETENTION_BREACH` log line is emitted.
- E2E: CORS preflight from allowed origin returns `Access-Control-Allow-Credentials: true` and an echoed `Access-Control-Allow-Origin` (never `*`).

**Frontend (both SPAs):**
- Unit: `apiClient` 401 handler — only `AUTH_TOKEN_EXPIRED` triggers refresh; `AUTH_INVALID_TOKEN` / `AUTH_FORBIDDEN_ROLE` route straight to `/login`.
- Unit: `apiClient` 401 handler — single-flight (concurrent 401s share one refresh promise), retry-once, second 401 → `/login`.
- Unit: app boot — silent refresh success → hydrates store + calls `/auth/me`; refresh failure → store stays null + `/login` rendered.
- Unit: app boot — `/auth/me` failure (5xx / network) after successful refresh → store cleared + `/login` rendered (no partial hydration).
- Unit: 401 retry recursion bound — backend returns `AUTH_TOKEN_EXPIRED` again on the retried request → handler does NOT re-enter refresh; redirects to `/login`.
- Unit: logout-during-refresh race — in-flight refresh resolves after logout; auth store remains empty (no resurrection); `isLoggingOut` flag cleared in `finally`.
- Unit: logout network failure → re-login on the same tab hydrates normally (flag was cleared in `finally`).
- Unit: prod build does NOT attach store to `window`; DevTools middleware gated on `import.meta.env.DEV`.
- E2E (admin): login → reload page → still on `/parents`, not redirected.
- E2E (admin): login → wait for access TTL → next API call transparently triggers refresh, no UI interruption.
- E2E (admin): logout → reload → redirected to `/login`.
- E2E (parent SPA): login → reload → still on protected route.

## Agent dispatch plan

| Wave | Agents (dispatched in one message) | Runs after |
|------|-------------------------------------|------------|
| 1 | `mes-scribe` — log start time in work-log | — |
| 2 | `mes-architect` — ADR 0007 + ADR 0003/0005/0006 amendments + `auth-and-rbac.md` updates | Wave 1 |
| 3 | `mes-shared-maintainer` — `AuthCookieConsts`, `IRefreshErrorCode` types, `XHR_REQUESTED_WITH` const | Wave 2 |
| 4 | `mes-backend-nestjs` — migration, repository, service changes (transactional rotation + grace-window reuse-detection), guards, endpoints, cookie wiring, CORS allow-list, BullMQ cleanup processor | Wave 3 |
| 5 | `mes-frontend-react` — apiClient refactor (single-flight + error-code allow-list + logout race), silent-refresh-on-boot + `/auth/me` rehydration, sessionStorage full removal — applied to **both** `apps/admin/` and `apps/web/` | Wave 3 |
| 6 | `mes-devops` — verify cookie set/clear in built docker image (curl smoke), confirm CORS allow-list env wiring, confirm `pino` redact paths active | Wave 4 ∥ 5, **after both complete** |
| 7 | `mes-qa-engineer` — full backend + frontend test suites per Tests section | Wave 4 ∥ 5, **after both complete** |
| 8 | `mes-review-security` **∥** `mes-review-logic` **∥** `mes-review-clean-code` | Wave 6 + 7 |
| 9 | `mes-scribe` — `docs/features/auth-refresh.md`, update `docs/api.md` (Set-Cookie + X-Requested-With contract documented), close work-log row, advance `CLAUDE.md` "Current milestone" pointer | Wave 8 |

**Wave 4 ∥ 5 — parallel-safe because:**
- Backend and frontend depend only on the contract drafted in ADR 0007 (Wave 2) + shared types (Wave 3).
- Wave 6 (devops smoke) and Wave 7 (QA) explicitly wait for **both** lanes to land — frontend e2e cannot run against a half-built backend.

## Verification

1. Log into admin panel → reload page → still authenticated, on `/parents`.
2. Log into parent SPA → reload page → still authenticated.
3. `curl -i -X POST http://localhost:3010/auth/login -H 'Content-Type: application/json' -d '…'` — response includes `Set-Cookie: mes_rt=...; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=604800` (and `Secure` in prod-like env).
4. `curl -i -X POST http://localhost:3010/auth/refresh` (no cookie) → 401 `REFRESH_TOKEN_MISSING`.
5. `curl -i -X POST http://localhost:3010/auth/refresh -b "mes_rt=stolen" -H "Origin: http://localhost:5173"` (no `X-Requested-With`) → 403 `REFRESH_CSRF_REJECTED`.
6. Same call with `X-Requested-With: XMLHttpRequest` but `Origin: http://evil.example` → 403 `REFRESH_CSRF_REJECTED`.
6a. Same call with `Origin: null` → 403 `REFRESH_CSRF_REJECTED`.
6b. Same call with neither `Origin` nor `Referer` → 403 `REFRESH_CSRF_REJECTED`.
7. **Replay (theft path):** capture a refresh token, refresh once, wait >10s, replay original → 401 `REFRESH_TOKEN_REUSED`, *and* the rotated successor returns 401 on its next use. `logger.warn({ code: 'REFRESH_TOKEN_REUSED' })` appears in logs.
8. **Replay (grace path):** capture a refresh token, refresh once, immediately replay original from same UA within 10s → returns the same successor token, family intact, no warn log; response cookie `Max-Age` reflects the original `successor.expires_at`, not refreshed.
9. After 10 minutes idle, the next API call from the SPA transparently triggers a refresh (visible in network tab) — no user-visible interruption.
10. Logout → cookie cleared (verify via DevTools that `mes_rt` is gone) → refresh attempt → 401.
11. Cleanup processor — manually backdate `expires_at` past the 7-day grace OR `revoked_at` past 30 days, trigger the BullMQ repeatable, rows gone, deleted-counter logged.
11a. Cleanup hard-fallback — manually insert a row with `revoked_at = now() - 70 days`, trigger job, verify `code: REFRESH_TOKEN_RETENTION_BREACH` log line.
12. `pino` redact — issue a refresh, verify no log line contains the raw `mes_rt` value, `cookie` header, or `set-cookie` header.
12a. **Safari cookie-clear** — manually verify (or e2e via WebKit/Playwright) that logout actually deletes the cookie in Safari (historical attribute-parity quirk).
13. All three reviewers report no blockers.

## Definition of Done

- All thirteen verification steps pass.
- Backend test suite green (existing 28 + new ~16 = ~44).
- Both frontend test suites green.
- ADR 0007 merged; ADR 0003, 0005, 0006 carry their respective amendment notes with back-links.
- `docs/work-log.md` row closed with end time.
- `CLAUDE.md` "Current milestone" pointer advanced.

## Risks & open questions

- **Risk:** sliding-window refresh + 10min access TTL increases refresh request volume (~6/hr per active user). Acceptable; observable via the `code: REFRESH_OK` / `REFRESH_FAIL` log signals.
- **Risk:** the 10s grace window opens a tiny replay window — by design. With v3's UA-only match (IP dropped for mobile/CGNAT compatibility), an attacker on the same UA string within 10s of legitimate rotation can hijack the successor. UA strings are common (Chrome/Safari major versions cluster), so this is weaker than v2's IP+UA match — accepted as the price of not logging out mobile users mid-handoff.
- **Risk:** the cookie-overwrite behavior on multi-tab login produces orphaned families that linger until cleanup. Functionally correct (no security issue) but produces transient extra rows in `refresh_tokens`. Monitored via the cleanup-job deleted-counter.
- **Risk:** `/auth/me` adds one extra round trip on app boot. Trade-off vs putting `email` in the JWT (would bloat every API request header). Boot-time round trip wins because it amortizes; documented here so reviewers don't re-litigate.
- **Risk:** best-effort logout that fails (timeout exhausted, network down) leaves the cookie server-side valid until natural TTL expiry. Mitigation: client retries logout once with short timeout; on next app boot, if a stale cookie exists for an account that was logged out, the silent refresh will succeed and the user is implicitly logged back in. Not a security issue (the user owned the cookie); a UX surprise.
- **Risk:** Lax cookie behavior across browsers — header check is the actual CSRF defense, Lax is defense-in-depth. If a future apiClient regression drops `X-Requested-With`, we lose CSRF protection silently. The cross-origin form-POST e2e (Tests §) catches this.
- **Open:** future `kid`-based JWT key rotation — deferred to its own ADR.
- **Open:** if Bull Board (M07/M08 bonus) is mounted with long-poll/WebSocket, verify it tolerates a transparent token swap mid-session.
- **Open:** Sequencing committed to "after M08" (§Sequencing); if M08 is delayed, escalate to orchestrator before falling back to neutral-`infra/queues/` scaffolding.

## Review notes incorporated (v3)

### v3 fixes (this revision)

Convergent v2 re-review findings:

1. **Origin guard hardening** (security MAJOR) — `Origin: null`, missing `Origin` AND `Referer`, disallowed `Origin` all hard-rejected; no implicit allow. Explicit e2e for each path. Guard moved to `common/guard/` (§9, backend deliverables).
2. **Grace-window mobile/CGNAT relaxation** (security MAJOR + logic MINOR) — IP matching dropped; UA-only match. False-positive logout rate observable via `REFRESH_TOKEN_REUSED` log signal. Trade-off documented in Risks (§7, Risks).
3. **Sequencing committed to Option A** (logic MINOR + arch MAJOR) — M09 lands after M08, no conditional. If forced earlier, scaffolding lives in neutral `infra/queues/`, requires separate review (§Sequencing).
4. **Grace-path successor expiry** (logic MAJOR) — successor `expires_at` NOT refreshed; cookie `Max-Age` recomputed from `successor.expires_at - now()`. Prevents attacker-driven family slide (§7, e2e).
5. **Logout-flag lifecycle concrete** (logic MAJOR / PARTIAL→RESOLVED) — `authStore.isLoggingOut` set before POST, cleared in `finally`, also cleared on login/signup. Refresh-promise `.then()` checks the flag before hydrating. Unit test for "logout network failure → re-login hydrates normally" (Frontend deliverables, Tests).
6. **`/auth/me` failure on boot** (logic MAJOR) — drop access token + render `/login`; no partial hydration, no retry (Frontend deliverables, Tests).
7. **ADR 0006 recursion bound** (logic MAJOR / PARTIAL→RESOLVED) — retried request bypasses 401 handler entirely; any 401 on retry → `/login`. Unit test for the recursion bound (ADR 0006 amendment, Tests).
8. **ADR 0004 amendment** (arch MAJOR) — `maintenance` queue category specced (naming convention, lifecycle, future inhabitants) so the next periodic-sweep milestone doesn't reinvent the pattern (ADR 0004 amendment).

Notable minors folded in:
- `OriginAllowedGuard` placement → `common/guard/` (CORS concern, reusable beyond auth).
- In-memory store XSS hardening → no `window` attach in prod, DevTools middleware gated on `import.meta.env.DEV`.
- Best-effort logout → retry once with short timeout (3s), `finally` always clears flag.
- `THROTTLE_REFRESH_LIMIT = 30/min` per-cookie-then-IP fallback (CGNAT-friendly).
- Two-tab cookie overwrite documented as expected; e2e asserts no spurious `REFRESH_TOKEN_REUSED`.
- Observability deliverables downgraded from "metrics counters" to "structured log fields with stable `code` values" (no metrics pipeline today).
- `/auth/me` extra round-trip vs JWT bloat — explicit Risks entry.
- Grace-window cross-reference to ADR 0006 idempotency-key sweep noted.
- Safari cookie-clear manual verification (or WebKit/Playwright e2e) added.
- `REFRESH_TOKEN_RETENTION_BREACH` error code + cleanup-job hard-fallback assertion (catches silent cleanup-job failure leaving PII past forensic window).
- Cross-origin form-POST e2e added (catches future `X-Requested-With` regression silently undermining Lax).

### v2 fixes (carried forward, all RESOLVED)

1. Cookie `Path=/auth` + attribute-parity on clear (§4, deliverables, e2e).
2. `SameSite` Strict → Lax (preserves cross-site landing UX).
3. Reuse-detection grace window + transactional rotation with `SELECT FOR UPDATE` (§6, §7).
4. ADR 0006 amended for the new 401 retry rule.
5. `Origin`/`Referer` allow-list guard added (§9).
6. `apps/web/` boot refactor flagged (§Frontend).
7. sessionStorage full removal — both token + user-metadata keys (§Frontend).
8. Cleanup job → BullMQ repeatable (ADR 0004 alignment).
9. `UNIQUE(token_hash)` constraint (§5).
10. Wave dispatch — Waves 6 + 7 require both lanes complete.
11. Retry trigger allow-list (only `AUTH_TOKEN_EXPIRED` triggers refresh).
12. Cleanup grace constants split (`REFRESH_TOKEN_GRACE_DAYS = 7`, `REFRESH_TOKEN_FORENSIC_DAYS = 30`).
13. Access TTL 5 → 10 min.
14. `pino` redact paths.
15. `X-Requested-With: XMLHttpRequest` canonical value, shared const.
16. `REFRESH_TOKEN_REUSED` security log signal.
17. Verify `cookie-parser` need via context7 before adding the dep.
18. Tests: two-tab concurrent logins, signup-vs-login parity.
19. `Set-Cookie` + `X-Requested-With` in `docs/api.md`.
20. Architectural constraint: `/auth/*` route prefix is now load-bearing.

### Deferred

- `kid`-based JWT key rotation — separate ADR.
- Device-management UI — out of scope.
- CSRF posture as a separable ADR — kept inside ADR 0007 §9 with a sub-heading; split if mobile clients land.
- Metrics pipeline — separate observability ADR.

## Outcome

**Status:** Shipped M09.

### Deliverables

All architecture, shared-package, backend, and frontend deliverables per the brief landed:

**Architecture (ADRs & docs):**
- ADR 0007 (refresh token rotation) — full design with transactional rotation, grace-window reuse-detection (10s UA-only after v3), CSRF defence (SameSite=Lax + header check + Origin guard with hard-rejection rules), cleanup job + retention breach fallback.
- ADR 0003 amendment — access token TTL change (15m → 10m), back-link to ADR 0007.
- ADR 0005 amendment — error-code table additions, redact-path additions.
- ADR 0006 amendment — 401 retry rule with recursion bound (retried request bypasses handler; any 401 on retry → `/login`).
- ADR 0004 amendment — `maintenance` queue category (naming convention, first inhabitant `refresh-token-cleanup`).
- `docs/architecture/auth-and-rbac.md` — sequence diagrams for login, refresh (happy + grace), logout, reuse-detection (theft path) verified current after implementation.

**Shared package (`packages/shared`):**
- `AuthCookieConsts.ts` — `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_PATH`, `XHR_REQUESTED_WITH`.
- `IRefreshErrorCode.ts` — `REFRESH_TOKEN_MISSING | INVALID | EXPIRED | REUSED | REFRESH_CSRF_REJECTED`.

**Backend (`apps/backend`):**
- Migration — `refresh_tokens` table + indexes (UNIQUE token_hash).
- `RefreshTokensRepository` (in `auth/repository/`).
- `OriginAllowedGuard` (in `common/guard/`) — origin validation with hard-rejection rules (null Origin, missing Origin+Referer, disallowed origin).
- `AuthService` — transactional `login()`, `signup()`, `refresh()` (with grace-window reuse-detection), `logout()` (idempotent single-token revoke).
- Endpoints — `POST /auth/refresh`, `POST /auth/logout` (both `@Public()`, `OriginAllowedGuard`, `X-Requested-With` check).
- Cookie handling — `Set-Cookie` on login/signup/refresh, clear on logout (attribute parity).
- CORS — `credentials: true`, allow-list function form (echo origin, never `*`).
- `RefreshTokenCleanupProcessor` — BullMQ repeatable job on `maintenance` queue, daily 03:00 UTC, TTL + forensic windows + retention-breach fallback.
- Constants — `JWT_EXPIRES_IN` default 10m, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_REUSE_GRACE_SECONDS`, `REFRESH_TOKEN_GRACE_DAYS`, `REFRESH_TOKEN_FORENSIC_DAYS`, `THROTTLE_REFRESH_LIMIT`.
- Backend tests — 44+ tests passing (rotation, grace-path, theft-path, cleanup, CSRF paths, cookie attributes, cross-family isolation, etc.).

**Frontend (both `apps/admin/` and `apps/web`):**
- `apiClient` — `credentials: 'include'`, always send `X-Requested-With: XMLHttpRequest`, 401 handler single-flight + error-code allow-list (retry only on `AUTH_TOKEN_EXPIRED`), retry-once with recursion bound.
- App boot — silent `/auth/refresh` on mount, hydrate with `/auth/me` on success, render `/login` on failure or `/auth/me` network blip.
- Logout race — `isLoggingOut` flag set before POST, cleared in `finally`, refresh promise checks flag before hydrating.
- sessionStorage cleanup — fully removed `AUTH_TOKEN_SESSION_STORAGE_KEY` and `AUTH_SESSION_STORAGE_KEY` (user metadata sourced from boot `/auth/me`).
- XSS hardening — no `window` attach in prod builds, DevTools middleware gated on `import.meta.env.DEV`.
- Frontend tests — both SPAs have new unit tests (single-flight, 401 handling, boot path, logout race, recursion bound, no partial hydration on `/auth/me` failure, prod build checks).

### Review findings

**All three reviewers' blockers and highs from implementation + 2 review rounds cleared.** Deferred non-blocking items logged for traceability:
- DataSource-injection refactor (code smell, future M-series cleanup).
- RefreshTokenEntity bigint schema validation (NestJS ORM orthogonal concern).
- Concurrent-rotation deadlock analysis (theoretical; SELECT FOR UPDATE + low refresh traffic makes collision vanishingly rare).
- JwtModule global scope comment (architectural documentation, M-series sprawl).

### Known deviations from brief

None. All 13 verification steps from the brief passed; 44+ backend + 20+ frontend tests green; 0 blockers/highs at final review.

### Files updated for evaluator

- **`docs/features/auth-refresh.md`** — feature doc covering cookie attributes, rotation transactional flow, grace-window design, CSRF layers, frontend integration, cleanup job, error codes.
- **`docs/api.md`** — added `POST /auth/refresh` and `POST /auth/logout` endpoints with Set-Cookie response header documented, added 6 new error codes to reference table.
- **`docs/work-log.md`** — M09 row closed with end time, duration, outcome summary.
- **`CLAUDE.md`** — milestone pointer advanced (M01–M08, M09 done; M10 the sole outstanding).
- **`docs/architecture/auth-and-rbac.md`** — verified sequence diagrams remain current post-implementation (no changes needed).
