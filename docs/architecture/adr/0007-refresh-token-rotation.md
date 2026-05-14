# ADR 0007 — Refresh Token Rotation (httpOnly cookie)

- **Status:** Accepted (2026-05-14)
- **Deciders:** mes-architect, mes-orchestrator; reviewed by `mes-review-security` and `mes-review-logic`
- **Tags:** auth, security, session, cookies

## Context

ADR 0003 issued a 15-minute access JWT and explicitly deferred refresh tokens to a "Next steps" item. The consequences played out as expected:

- A page reload drops the in-memory access token and forces re-login. Acceptable in a demo, painful in practice — admins reload the panel, parents return from email links, students reopen tabs.
- The 15-minute token is the only credential. Shortening its TTL to limit blast-radius makes the UX worse; lengthening it makes a token leak last longer.
- The cross-app follow-up logged at the end of M07 (sessionStorage bandaid for admin SPA) was a tactical patch around the same hole.

The correct answer — well understood industry pattern — is a **short-lived access token in JS memory** paired with a **long-lived opaque refresh token in an httpOnly cookie**, rotated on every use, with reuse-detection that revokes the entire token family on replay. M09 ships that pattern and supersedes the `Authorization`-bearer-only stance of ADR 0003 in part.

The constraints that drove this design:

- The refresh credential must be unreachable from JS to neutralise an XSS that bypasses our CSP.
- Cookies bring CSRF surface back into scope. The defence must be layered, not single-rule.
- Rotation must be atomic. A reuse-detection scheme that races itself under network retries is worse than no rotation at all.
- Mobile and CGNAT clients flip IPs on handoff and share egress IPs across thousands of users. An IP-based reuse heuristic logs them out in normal operation.
- The cleanup mechanism must live where every other periodic-sweep job will live, not in a one-off cron handler.

## Decision

### 1. Token shapes

- **Access token:** unchanged JWT shape (`HS256`, payload `{ sub, role, iat, exp }`). **TTL lowered from 15 → 10 minutes** via `JWT_EXPIRES_IN`. Initial proposal was 5 minutes; the architect review settled on 10 — same blast-radius posture for a leaked token, half the refresh chatter. Returned in the JSON body of `/auth/login`, `/auth/signup`, and `/auth/refresh`. Kept in JS memory only.
- **Refresh token:** opaque random 256-bit value, `crypto.randomBytes(32).toString('base64url')`. **NOT a JWT** — no claims, no signing key required, no `alg` confusion surface. **TTL: 7 days, sliding** — every successful refresh issues a new token with a fresh 7-day expiry, except in the grace-window path (see §6).
- **Algorithm pin** from ADR 0003 carries forward unchanged for the access JWT. ADR 0007 re-states it: `algorithms: ['HS256']` on every verifier.

### 2. Cookie attributes

```
Set-Cookie: mes_rt=<token>; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
```

- `HttpOnly` — unreachable from JS, mitigates XSS exfiltration.
- `Secure` — conditional on `NODE_ENV === 'production'`. Dev/test on `http://localhost` would otherwise never receive the cookie.
- `SameSite=Lax` (**not Strict**). Strict drops the cookie on cross-site top-level navigations, which breaks the invitation-email landing path: the user clicks a link in their email client, lands on `/onboard`, and the first refresh would arrive without the cookie. Lax + the layered defences in §9 give equivalent CSRF posture without breaking that path.
- `Path=/auth` — the cookie is only transmitted to endpoints under `/auth/*`. All cookie-bearing endpoints (`/auth/refresh`, `/auth/logout`) live under that prefix.
- `Max-Age=604800` — 7 days, matches the server-side `expires_at`. The grace-window successor uses a recomputed `Max-Age` (§6).
- `Domain` — **unset**. The cookie is host-only (binds to the API origin). No subdomain leakage.

#### Cookie topology — the `/auth` prefix is load-bearing

Because `Path=/auth` scopes the cookie to that subtree, **renaming the auth module's HTTP route prefix invalidates every live refresh token**. This is now an architectural invariant: the `auth` route prefix is part of the cookie contract, not just URL ergonomics. Any future renaming requires a parallel-issuance migration (issue at both old and new paths for one full TTL window) or accepts that every user re-logs in.

### 3. Storage — `refresh_tokens` table

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL PK` | surrogate identity |
| `user_id` | `BIGINT NOT NULL` | FK → `users.user_id` |
| `family_id` | `UUID NOT NULL` | groups all tokens descended from one initial login |
| `token_hash` | `CHAR(64) NOT NULL` | `SHA-256` hex of the raw token; **`UNIQUE`** |
| `issued_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | absolute expiry |
| `revoked_at` | `TIMESTAMPTZ NULL` | non-null = rotated or theft-revoked |
| `replaced_by_id` | `BIGINT NULL` | FK self → `refresh_tokens.id`, the successor token |
| `user_agent` | `TEXT NULL` | captured at issue, used for grace-window match |
| `ip` | `INET NULL` | captured at issue, **NOT** used for grace-window match (see §7) |

Indexes:

- `UNIQUE (token_hash)` — collisions or double-inserts must hard-fail. The unique violation is the safety net under the transactional rotation in §6.
- `(family_id)` — family-level revocation lookup.
- `(user_id, revoked_at)` — "list active sessions for this user" reads (used by cleanup and future device-management UI).

**Raw tokens are never stored.** Only the SHA-256 hash. A leaked DB dump yields hashes only; the cookie value itself is the credential.

### 4. Token rotation — transactional, "commit before Set-Cookie"

Every successful `/auth/refresh` runs the following inside a single DB transaction:

1. `SELECT … FOR UPDATE` on the row matching the submitted token's hash. The row lock serialises any concurrent refresh attempts on the same token.
2. Validate (see §5, §7) — expiry, revocation state.
3. If valid (and not in the grace path): generate a new raw token, hash it, `INSERT` a new row with the same `family_id`, fresh `expires_at = now() + 7 days`, fresh `issued_at`, captured `user_agent` and `ip`.
4. `UPDATE` the old row: `revoked_at = now()`, `replaced_by_id = <new.id>`.
5. **Commit the transaction.**
6. **Only after a successful commit** does the controller write the `Set-Cookie` header with the new raw token.

The sequencing — commit *before* Set-Cookie — is load-bearing. If the cookie were written first and the commit then failed, the client would walk away with a cookie the server never persisted, indistinguishable from a forged token on its next refresh. With the commit first, the client either receives both the JSON body and the cookie (success) or neither (transaction rolled back, no response sent yet, error filter renders 5xx).

### 5. Validation rules

A submitted refresh token is **valid** iff all of:

- It hashes to a row in `refresh_tokens`.
- That row's `expires_at > now()`.
- That row's `revoked_at IS NULL` **or** it qualifies for the grace path in §7.

Failure mappings:

| Condition | HTTP | `code` |
|---|---|---|
| Cookie absent | 401 | `REFRESH_TOKEN_MISSING` |
| Cookie present, hash not in table | 401 | `REFRESH_TOKEN_INVALID` |
| Row exists, `expires_at <= now()` | 401 | `REFRESH_TOKEN_EXPIRED` (no family revocation — natural expiry isn't theft) |
| Row exists, revoked, grace-path qualifies | 200 (re-issue successor) | — |
| Row exists, revoked, grace-path does not qualify | 401 | `REFRESH_TOKEN_REUSED` (entire family revoked) |
| Origin/Referer / `X-Requested-With` checks failed | 403 | `REFRESH_CSRF_REJECTED` |

### 6. Sliding window — except in the grace path

The default behaviour is **sliding**: every successful rotation issues a token with a fresh 7-day `expires_at`. A user who refreshes once a day every day stays signed in indefinitely.

**The grace path is the exception.** When the legitimate-replay path fires (§7), the server re-issues the **same successor** that the original rotation produced. The successor's `expires_at` is the one assigned at original rotation time; it is **not** refreshed. The response cookie's `Max-Age` is recomputed as `successor.expires_at - now()`. Without this rule an attacker could replay a captured token inside the grace window and silently extend the family's lifetime past what any legitimate session would have produced.

### 7. Reuse-detection — grace window with UA-only match

A revoked token arriving at `/auth/refresh` is one of two things:

- **Legitimate retry.** The user's request succeeded, the server committed the rotation, but the network dropped the response. The client retries with the only token it has — the now-revoked predecessor.
- **Replay attack.** Someone captured the cookie (server log accident, browser-extension exfiltration, MITM with a malicious root CA) and is trying to use it after the legitimate user already rotated.

The two are indistinguishable from the token alone. We use a **time-bounded grace window with a `user_agent` match** as a heuristic:

```
if revoked AND replaced_by_id IS NOT NULL
   AND (now() - revoked_at) < REFRESH_REUSE_GRACE_SECONDS    // default 10s
   AND user_agent == row.user_agent
then: grace path — re-issue the successor verbatim (§6)
else: theft path — revoke entire family, log, return 401
```

#### Why `user_agent` only — IP is intentionally dropped

The earlier v2 design used `(ip, user_agent)` match. v3 drops the IP check after explicit mobile-network analysis:

- **Mobile Wi-Fi ↔ LTE handoff** flips the egress IP mid-session. A legitimate retry across a handoff would fail the IP check and trigger family revocation, logging out the user.
- **CGNAT** (carrier-grade NAT) shares one egress IP across thousands of subscribers; the IP check is approximately useless as a same-device signal there.
- **Mobile carriers in some regions** rotate IPs per request through transparent proxies.

The chosen trade-off: UA-only match. False-positive logouts are bounded by the 10-second grace window (small) and observable via the `REFRESH_TOKEN_REUSED` log signal (operators can quantify the rate). False-negative theft within 10 seconds on the same UA string is the residual risk — accepted and called out in the milestone's Risks section.

#### Theft path

```
UPDATE refresh_tokens
   SET revoked_at = now()
 WHERE family_id = $1
   AND revoked_at IS NULL;

logger.warn({
  code: 'REFRESH_TOKEN_REUSED',
  userId,
  familyId,
  ipPrefix,    // /24 for v4, /64 for v6 — useful for forensics without storing the full IP at warn level
  uaMatch,     // boolean: did the replay UA match the original?
});
```

Return 401 `REFRESH_TOKEN_REUSED`. The user is logged out of every device in that family. They re-log; a fresh family starts.

### 8. CSRF defence — layered

Cookies expose the endpoint to cross-site request forgery. The defence is three independent layers; an attacker must bypass all three.

#### Layer 1 — `SameSite=Lax`

Blocks the cross-site form-POST default behaviour: a malicious page's `<form action="https://api.example.com/auth/refresh" method="POST">` will not carry the cookie. Lax (not Strict) preserves cross-site top-level navigation — the invitation-email landing path stays working.

#### Layer 2 — required `X-Requested-With: XMLHttpRequest`

Both `/auth/refresh` and `/auth/logout` reject any request without this header. Browsers do not let HTML forms set custom headers; the only way to send `X-Requested-With` is `fetch` / `XMLHttpRequest`, both of which trigger CORS preflight on cross-origin attempts. Preflight against our allow-list (§10) shuts down a cross-origin attacker before the actual POST fires.

The canonical value `XMLHttpRequest` is exposed as a shared constant (`XHR_REQUESTED_WITH`) so the SPA and the backend guard agree at compile time.

This layer is the **actual** CSRF defence — Lax is defence-in-depth. The end-to-end suite includes a cross-origin form-POST test that verifies the rejection still fires if Lax ever regresses in a future browser update.

#### Layer 3 — `Origin` / `Referer` allow-list, with hard-rejection rules

Implemented as `OriginAllowedGuard`, placed in `common/guard/` (CORS concern, reusable beyond auth). The guard reads the CORS allow-list (env-driven, the same one §10 echoes) and applies these rules **with no implicit allow**:

| Headers observed | Result |
|---|---|
| `Origin: null` | **403 `REFRESH_CSRF_REJECTED`** — covers sandboxed iframes, `file://`, redirect chains |
| Both `Origin` and `Referer` absent | **403 `REFRESH_CSRF_REJECTED`** — never fall back to "absent ⇒ allowed" |
| `Origin` present, not in allow-list | **403 `REFRESH_CSRF_REJECTED`** — regardless of what `Referer` says |
| `Origin` absent, `Referer` present, origin parses to an allow-listed value | OK |
| `Origin` present in allow-list | OK |

E2E asserts each rejection branch explicitly so the rules can't silently relax under a guard refactor.

### 9. CORS — echo origin, never `*` with credentials

Bootstrap in `apps/backend/src/main.ts`:

```
app.enableCors({
  credentials: true,
  origin: <function form>,    // reads CORS_ALLOWED_ORIGINS, echoes matched value
});
```

`credentials: true` is mandatory for the browser to send the cookie. Combined with `Access-Control-Allow-Origin: *` browsers will **refuse** to attach credentials — the response header must echo the specific request `Origin`. The function form is used (not the array form) so that the matched origin is echoed verbatim and unmatched origins return without an ACAO header (browser blocks the response).

The allow-list is the same one the `OriginAllowedGuard` reads. Single source of truth.

### 10. Cleanup — BullMQ repeatable on a `maintenance` queue

Per ADR 0004's "BullMQ for all async work" stance, cleanup is a repeatable job:

- **Queue:** `maintenance` (new category — see ADR 0004 amendment).
- **Job:** `refresh-token-cleanup`, processor `RefreshTokenCleanupProcessor` in `auth/job/`.
- **Schedule:** `0 3 * * *` (daily 03:00 UTC).
- **Work:** two `DELETE` clauses, both inside one transaction:
  1. `expires_at < now() - interval '7 days'` (TTL forensic grace — `REFRESH_TOKEN_GRACE_DAYS`).
  2. `revoked_at < now() - interval '30 days'` (revocation forensic grace — `REFRESH_TOKEN_FORENSIC_DAYS`).
- **Logs:** `{ deletedExpired, deletedRevoked }` at info level.

#### Retention-breach hard assertion

The same job runs a guardrail SQL probe **after** the deletes:

```
SELECT count(*) FROM refresh_tokens
 WHERE revoked_at < now() - interval '60 days';
```

If the count is non-zero, emit `logger.error({ code: 'REFRESH_TOKEN_RETENTION_BREACH', count })`. This catches the failure mode where the cleanup job silently breaks (Redis outage, processor crash loop, accidentally disabled schedule) and PII columns `user_agent` / `ip` retain past the forensic window. The error code makes the breach detectable from log search alone — no metrics pipeline required.

### 11. Logout

`POST /auth/logout` revokes the **single token** identified by the cookie, not the whole family. Two devices logging out independently must not log each other out.

- Same guard stack as `/auth/refresh` (`OriginAllowedGuard`, `X-Requested-With` header check).
- Idempotent: a logout for an already-revoked token returns 204 without raising.
- Cookie cleared with **attribute parity** — every attribute identical to the issuing cookie, only `Max-Age=0` and value empty:

```
Set-Cookie: mes_rt=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0
```

Safari historically refuses to clear cookies when attributes don't exactly match; the e2e suite explicitly asserts the cookie-clear works in WebKit.

## Rationale

The composition of these eleven rules is the design. The individual rules are conventional; the engineering work is making sure none of them undermines another:

- **The `SameSite=Lax + X-Requested-With + Origin allow-list` triple** means an attacker has to defeat three independent mechanisms to forge a refresh. Each is a known industry pattern; the layering is the contribution.
- **`SELECT … FOR UPDATE` + commit-before-Set-Cookie** is the only ordering that makes rotation idempotent under network retries without introducing a phantom-cookie failure mode.
- **Grace window with UA-only match** is the engineering trade-off most likely to be re-litigated. The Risks section in M09 calls out both directions explicitly: this is weaker than v2's `(ip, ua)` heuristic for theft within the 10s window, and the operator-observable `REFRESH_TOKEN_REUSED` rate is the canary.
- **BullMQ maintenance queue with a retention-breach assertion** keeps the PII column dwell time bounded even if the cleanup job itself fails — defense in depth for a regulator-style question we shouldn't have to answer in code review.

## Consequences

**Positive:**

- Page reload keeps the user signed in; XSS still cannot exfiltrate the long-lived credential.
- Server-side logout is now possible (`/auth/logout` flips `revoked_at`); the "no revocation list" trade-off in ADR 0003 is partially resolved for the refresh side, though access JWTs remain stateless and valid until natural expiry.
- Stolen refresh tokens are detected on the attacker's *or* the victim's next refresh, whichever comes first — the family dies in either case.
- All periodic-sweep jobs now have an obvious home (the `maintenance` queue); the next milestone that needs one inherits the pattern.

**Negative / acknowledged trade-offs:**

- **Refresh request volume rises** to ~6/hr per active user (10-min access TTL + sliding refresh). Observable; not a real cost on this scale.
- **Grace-window false-negative theft** within 10s on a matching UA string is unrecoverable. Mitigated by the small window; accepted because tightening it logs out mobile users.
- **`/auth/me` round trip on app boot** adds latency on a cold start (the access JWT carries no email; we re-fetch it). Trade-off considered explicitly vs putting `email` in the JWT — the latter would bloat every API request header for the rest of the session. Boot-time amortises better.
- **Best-effort logout that fails to reach the server** leaves the cookie valid until natural expiry; on next app boot the silent refresh implicitly re-logs the user in. Not a security issue (the user owns the cookie) but a UX surprise; documented.
- **`/auth` route prefix is load-bearing.** Renaming the auth module invalidates every live cookie. New architectural invariant.

## Alternatives considered

### Refresh as JWT (not opaque)

A signed-but-not-encrypted refresh JWT would let the server validate without a DB lookup. Rejected because:

- Reuse detection requires DB state anyway (the "this token was revoked" signal cannot live in a stateless JWT). The DB lookup is unavoidable.
- A JWT refresh token leaked to a log file is a credential; an opaque token leaked to a log file is also a credential, but it has no claims an attacker can read.
- JWTs reintroduce the `alg` confusion surface that ADR 0003 pins out for the access token. Opaque tokens have no such surface.

### `SameSite=Strict` instead of Lax

Stricter CSRF posture; cleanest theoretical answer. Rejected because the invitation-email flow (parent forwards a link, student lands cross-site → `/onboard` → first refresh) loses the cookie under Strict and breaks. The layered defences in §8 give equivalent posture without the UX cost.

### `(ip, user_agent)` match for grace window (v2 design)

Stronger against theft inside the 10s window. Rejected after mobile/CGNAT analysis: false-positive logout rate would be unacceptable for normal mobile users. UA-only is the documented compromise.

### Refresh token as a database session row, no rotation

The "classic session cookie" model. Solves the same UX problem with simpler code. Rejected because it does not detect token theft — a captured cookie keeps working until the user clicks Logout. Rotation + reuse-detection is the specific defence-in-depth that an httpOnly cookie alone doesn't provide.

### CSRF token pattern (double-submit cookie or synchroniser token)

Industry-standard CSRF defence. Rejected as overkill given the layered defence in §8: `Lax + X-Requested-With + Origin allow-list` is sufficient for our threat model, and adding a CSRF token adds a round trip on every state-changing call. Reconsider if a future mobile client (which doesn't have browser CORS) ever lands.

### Cron handler in a generic `schedule` module instead of BullMQ

`@nestjs/schedule` would work. Rejected because we'd be reintroducing the "two different async patterns" smell ADR 0004 specifically chose to avoid. The `maintenance` queue category is the canonical home; the next sweep job (idempotency-key retention per ADR 0006, expired-invitation cleanup, etc.) inherits the same pattern.

### Cookie at `Path=/` instead of `Path=/auth`

Sends the cookie on every request — strictly more network bandwidth, strictly more places where a server-side log accident could capture it. Rejected. `Path=/auth` is the tightest scope that still covers `/auth/refresh` and `/auth/logout`.

## See also

- [0003-jwt-stateless-auth.md](./0003-jwt-stateless-auth.md) — superseded in part by this ADR
- [0004-bullmq-for-async.md](./0004-bullmq-for-async.md) — `maintenance` queue category added in amendment
- [0005-logging-and-error-handling.md](./0005-logging-and-error-handling.md) — error codes + redact paths added in amendment
- [0006-retries-and-idempotency.md](./0006-retries-and-idempotency.md) — frontend 401-retry rule amended
- [../auth-and-rbac.md](../auth-and-rbac.md) — login / refresh / logout / theft sequence diagrams
- [../async-jobs.md](../async-jobs.md) — `maintenance` queue inventory entry
