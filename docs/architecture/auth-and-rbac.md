# Auth & RBAC

> **Status:** finalised in M02 by `mes-architect`. Implementation lands in M03. Reviewed by `mes-review-security`.

## Roles (`UserRoleEnum`)

Defined in `packages/shared/src/enums/UserRoleEnum.ts` and consumed by both backend (guards) and frontend (route guards, UI gating).

| Role | Purpose | How a user gets it |
|---|---|---|
| `PARENT` | Browses catalog, buys courses, manages invitations under their account | self-signup via `POST /auth/signup` |
| `STUDENT` | Accesses the LMS (enrolled courses + lessons) | created by invitation redemption (`POST /invitations/redeem`) |
| `ADMIN` | Read-only operational view | seeded via M03 migration; no self-signup |

Role is stored on `users.role` as a PostgreSQL native ENUM (`user_role`, values `'PARENT' | 'STUDENT' | 'ADMIN'` — see `data-model.md` → "PostgreSQL ENUM types"); never inferred from JWT alone.

**Fresh-user re-validation policy** (no ambiguity):

- **ADMIN endpoints** (`/admin/*`) — guard performs a fresh DB load of the user by `sub` and re-checks `role === UserRoleEnum.ADMIN`. Demoting a user in the DB takes effect immediately on the next request.
- **All other authenticated endpoints** — guards trust the JWT claims (`sub`, `role`) without a DB lookup. Role changes for PARENT/STUDENT propagate at next token issuance, max 15 minutes delay (access token TTL). This is an explicit availability/cost trade-off documented in ADR 0003.

## JWT shape (`IJwtPayload`)

```ts
// packages/shared/src/types/IJwtPayload.ts
export interface IJwtPayload {
    sub: number;          // users.user_id
    role: UserRoleEnum;
    iat: number;          // issued-at (seconds since epoch)
    exp: number;          // expiry (seconds since epoch)
}
```

- **Algorithm:** HS256.
- **Secret:** `JWT_SECRET` (env var; required, ≥ 32 bytes). Backend refuses to boot if missing or too short.
- **Access token TTL:** `JWT_EXPIRES_IN` (default `15m`).
- **Refresh tokens:** **out of scope for v1.** Documented in README "Next steps". See ADR 0003 for rationale.
- **Token transport:** `Authorization: Bearer <token>` header. No cookies.
- **No PII in the payload.** Email and names are not in the JWT — they're fetched fresh from `/auth/me` when the SPA needs them.
- **Algorithm pinning:** the verifier MUST be configured with `algorithms: ['HS256']` (passed through `JwtModule.register({ verifyOptions })` and `JwtStrategy` constructor). This blocks the `alg: none` and `alg: RS256→public-key` confusion attacks.
- **Frontend token storage:** **in-memory only** (React context / store). Tokens MUST NOT be written to `localStorage`, `sessionStorage`, or cookies. Rationale: any XSS that escapes our CSP gets script execution but cannot enumerate browser storage to exfiltrate a long-lived token. A page reload re-prompts for login — acceptable for v1 because there's no refresh token to lose. See ADR 0003.

## Guard wiring

Every protected route is protected by the same pair of guards, registered globally so individual controllers cannot forget to apply them:

```ts
// apps/backend/src/app.module.ts
providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },   // runs first
    { provide: APP_GUARD, useClass: RolesGuard },     // runs second
    { provide: APP_PIPE,  useFactory: () => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
]
```

- **`JwtAuthGuard`** — verifies the bearer token, hydrates `request.user: IAuthenticatedUser`. Skipped on routes marked `@Public()`.
- **`RolesGuard`** — reads `@Roles(...)` metadata from the handler and class. If none is set, lets the request through (any authenticated user). If set, requires `request.user.role` to be one of the listed roles.
- **`@Public()`** — sets reflector metadata that `JwtAuthGuard` reads; the only legitimate way to expose an unauthenticated route. Used by `POST /auth/signup`, `POST /auth/login`, `POST /invitations/redeem`, `GET /invitations/:token/meta`, `GET /health/*`.

Source-of-truth files:
- `apps/backend/src/auth/guard/JwtAuthGuard.ts`
- `apps/backend/src/auth/guard/RolesGuard.ts`
- `apps/backend/src/auth/decorator/Public.ts`
- `apps/backend/src/auth/decorator/Roles.ts`

## Role matrix

Endpoint → allowed roles (final list locked here; M03–M08 implementations cite this table).

| Endpoint | Public | PARENT | STUDENT | ADMIN |
|---|---|---|---|---|
| `POST /auth/signup` | ✅ | — | — | — |
| `POST /auth/login` | ✅ | — | — | — |
| `GET /auth/me` | — | ✅ | ✅ | ✅ |
| `GET /health/live` | ✅ | — | — | — |
| `GET /health/ready` | ✅ | — | — | — |
| `GET /courses` | — | ✅ | ✅ | ✅ |
| _Note: `GET /courses` is **authenticated-any-role**, not Public. Students see the catalog read-only; the v1 UX surfaces it only on the parent web app, but the API permits all three roles to keep the surface uniform._ | | | | |
| `POST /purchases` | — | ✅ | ❌ | ❌ |
| `GET /me/purchases` | — | ✅ | — | — |
| `GET /invitations/:token/meta` | ✅ | — | — | — |
| `POST /invitations/redeem` | ✅ | — | — | — |
| `GET /me/courses` | — | — | ✅ | — |
| `GET /courses/:id/lessons` | — | — | ✅ (if enrolled) | — |
| `GET /lessons/:id` | — | — | ✅ (if enrolled) | — |
| `GET /admin/*` | — | — | — | ✅ |
| `POST /admin/invitations/:id/resend` | — | — | — | ✅ |
| `/admin/queues` (Bull Board, optional) | — | — | — | ✅ |

> `POST /admin/invitations/:id/resend` re-enqueues the `invitation.email.send` job for a given invitation. It is the documented mitigation for the post-commit enqueue gap (see `async-jobs.md`). The handler validates the invitation exists, is not yet redeemed, and has not expired, then performs a single atomic resend flow: (a) sets `invitations.email_sent_at = NULL` on the row, AND (b) calls `queue.remove(\`invitation-email-${invitationId}\`)` before `queue.add(..., { jobId: \`invitation-email-${invitationId}\` })` so the deterministic `jobId` dedup does not reject the second enqueue. Both (a) and (b) are required — the processor-level idempotency check keys on `email_sent_at IS NULL`, the queue-level dedup keys on `jobId`. See `async-jobs.md` → "Admin resend flow" for the canonical sequence.

> **Enrolment checks are enforced inside the service**, not by the guard. The guard only confirms role; the service confirms the student → course link via `enrolments`. A STUDENT requesting another student's lessons gets `404` (not 403), to avoid leaking lesson existence.

### `/me/*` IDOR invariant (hard rule)

Every `/me/*` endpoint MUST filter resources by `req.user.sub` server-side. Client-supplied user identifiers in route params, query strings, or request bodies are ignored or rejected — they MUST NOT be used to scope reads or writes. This is enforced by code review and by integration tests that attempt to read another user's data with the calling user's token; the expected outcome is 404 (not 403, to avoid leaking existence).

### Rate limiting

`@nestjs/throttler` is wired globally with per-route overrides. Limits are per IP (X-Forwarded-For honoured behind the compose proxy); the login limit additionally keys on the submitted username to prevent username-enumeration via single-IP brute force on many accounts.

**Trust-proxy configuration.** Backend sets `app.set('trust proxy', 1)` in `main.ts` to match the single compose proxy hop. With that hop count, Express's `req.ip` resolves the client IP from the `X-Forwarded-For` chain using only the value appended by the trusted hop — values appended further upstream (i.e. spoofed by the client) are ignored. The throttler's IP extractor uses `req.ip` directly, so per-IP limits are honoured correctly behind the compose proxy. **Direct-exposure deploys (no front proxy) MUST either lower this to `app.set('trust proxy', false)` or adjust the hop count to match their topology** — otherwise an attacker can forge `X-Forwarded-For` on direct requests and bypass per-IP throttling entirely.

| Route | Limit |
|---|---|
| `POST /auth/login` | 5 / minute per IP + username |
| `POST /auth/signup` | 3 / minute per IP |
| `POST /invitations/redeem` | 10 / minute per IP |
| `GET /invitations/:token/meta` | 20 / minute per IP |

Throttler responses use the canonical error shape with `code: RATE_LIMITED` and HTTP 429.

## Password hashing

- **Algorithm:** argon2id (via the `argon2` package).
- **Parameters (OWASP 2024 baseline):** `memoryCost: 65536` (interpreted as KiB by the `argon2` package → 64 MiB), `timeCost: 3`, `parallelism: 1`. Single-thread parallelism is the OWASP recommendation; bumping it offers little defence against attackers with parallel GPUs while raising the server's per-login CPU cost.
- **Pepper:** none in v1. Adding a pepper is on the README "Next steps".
- **Validation rules at signup (Zod):** min length 12, max length 128, at least one letter and one digit. Enforced in `packages/shared/src/schemas/signupSchema.ts` so the frontend and backend agree. The max length is not a UX cap — it is a DoS guard: argon2id cost is roughly linear in input length, so a megabyte-sized password submitted to `POST /auth/login` would pin a worker thread for seconds per request. Rejecting at the validation pipe before the hash call keeps the attack surface bounded.
- **Re-hash on login:** if `argon2.needsRehash()` returns true (parameters changed), the verified password is re-hashed and the user row updated transparently.

## Request authentication flow

```
client ── POST /auth/login {email, password} ─────────────────────────►
                                                                       │
backend: AuthService.login()                                           │
   ├─ usersRepository.findByEmail(email)                               │
   ├─ argon2.verify(stored_hash, password)                             │
   ├─ if mismatch → throw UnauthorizedError(AUTH_INVALID_CREDENTIALS)  │
   └─ sign({ sub, role }, JWT_SECRET, { expiresIn })                   │
client ◄── 200 { accessToken } ─────────────────────────────────────────
client ── any request with Authorization: Bearer <token> ─────────────►
                                                                       │
JwtAuthGuard:                                                          │
   ├─ extract token; jwt.verify → throws on bad sig / expired          │
   ├─ build IAuthenticatedUser { id, role } and attach to req          │
RolesGuard:                                                            │
   ├─ if @Roles set, check req.user.role is in the list                │
controller / service runs ...                                          │
client ◄── 200 | 401 | 403 | 4xx | 5xx ────────────────────────────────
```

### Canonical error codes (cross-module)

Stable across releases. Frontend branches on `code`, never on `message`.

Each row maps to exactly one `DomainError` subclass defined in ADR 0005 — services throw the class, the global `HttpExceptionFilter` renders the row's HTTP status and `code`. Rows marked _(filter-normalised)_ originate from Nest built-ins (guards, pipes, throttler) and are translated by the filter into the same JSON shape; service code never throws those built-ins directly.

| Condition | HTTP | `code` | `*Error` class (ADR 0005) |
|---|---|---|---|
| No `Authorization` header / malformed | 401 | `AUTH_MISSING_TOKEN` | `UnauthorizedError` _(filter-normalised from `JwtAuthGuard`)_ |
| Bad signature / `alg` mismatch / unknown `kid` | 401 | `AUTH_INVALID_TOKEN` | `UnauthorizedError` _(filter-normalised from `JwtAuthGuard`)_ |
| Expired | 401 | `AUTH_TOKEN_EXPIRED` | `UnauthorizedError` _(filter-normalised from `JwtAuthGuard`)_ |
| Authenticated but wrong role | 403 | `AUTH_FORBIDDEN_ROLE` | `ForbiddenError` _(filter-normalised from `RolesGuard`)_ |
| Login mismatch | 401 | `AUTH_INVALID_CREDENTIALS` | `UnauthorizedError` (constructed with sub-code `AUTH_INVALID_CREDENTIALS`) |
| Signup duplicate email | 409 | `USER_EMAIL_TAKEN` | `UserEmailTakenError` |
| Validation failure (Zod / ValidationPipe) | 400 | `VALIDATION_FAILED` | `ValidationFailedError` _(filter-normalised from `ValidationPipe`'s `BadRequestException`)_ |
| Throttler tripped | 429 | `RATE_LIMITED` | `RateLimitedError` _(filter-normalised from `ThrottlerException`)_ |
| `Idempotency-Key` header missing on a required endpoint | 400 | `IDEMPOTENCY_KEY_REQUIRED` | `IdempotencyKeyRequiredError` |
| Key reused, body matches the original, but original is still in-flight (no stored `response_body` yet) | 409 | `IDEMPOTENCY_KEY_REUSED` | `IdempotencyKeyReusedError` |
| Key replay returning stored response (info-level) | 200/2xx | `IDEMPOTENCY_REPLAY` | _(no error class — interceptor replays stored response and logs `info`)_ |
| Key reused with a different canonical body hash (permanent client error) | 409 | `IDEMPOTENCY_BODY_MISMATCH` | `IdempotencyBodyMismatchError` |
| Course not found | 404 | `COURSE_NOT_FOUND` | `CourseNotFoundError` |
| Lesson not found (raised by `GET /lessons/:id` and `GET /courses/:id/lessons` when the lesson does not exist; distinct from `ENROLMENT_NOT_FOUND` which means "exists but the caller cannot see it") | 404 | `LESSON_NOT_FOUND` | `LessonNotFoundError` |
| Enrolment not found (also returned for cross-tenant reads) | 404 | `ENROLMENT_NOT_FOUND` | `EnrolmentNotFoundError` |
| Enrolment already exists for `(student, course)` | 409 | `ENROLMENT_ALREADY_EXISTS` | `EnrolmentAlreadyExistsError` |
| Invitation token unknown | 410 | `INVITATION_NOT_FOUND` | `InvitationNotFoundError` |
| Invitation expired | 410 | `INVITATION_EXPIRED` | `InvitationExpiredError` |
| Invitation already redeemed | 410 | `INVITATION_ALREADY_REDEEMED` | `InvitationAlreadyRedeemedError` |
| Invitation email matches an existing user in any role | 410 | `INVITATION_EMAIL_CONFLICT` | `InvitationEmailConflictError` |
| Unexpected / unmapped | 500 | `INTERNAL_ERROR` | _(no class — filter fallback for any non-`DomainError` throw)_ |

**Oracle-resistance note.** `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_REDEEMED`, and `INVITATION_EMAIL_CONFLICT` all return HTTP **410** with the same body shape. To equalise wall-clock time across the four branches, the redeem handler performs the same DB work pattern in every branch:

1. **Lookup invitation by `token_hash`.** Hash the submitted token, then `SELECT ... FROM invitations WHERE token_hash = $1`.
2. **Always lookup user by email, regardless of which branch will fire.** If step (1) returned a row, the email used is `invitation.studentEmail`; if step (1) returned no row, the lookup runs against a fixed, constant dummy email (`oracle-equaliser@invalid.local` — same length class, never present in `users`) so the second query still hits the index with comparable cost.
3. **Decide which `DomainError` to throw** (or proceed to the redeem write path) based on the combined result of (1) and (2).

This guarantees the same number of queries and an approximately equal index-lookup cost on every failure branch. Combined with the identical response status (410) and identical body shape, an attacker probing `POST /invitations/redeem` cannot distinguish "token doesn't exist" from "email already taken" via response shape, status, or timing.

## Frontend role enforcement

Backend is always the source of truth — frontend role checks exist to avoid showing dead UI, not to enforce security.

- `apps/web` route guards: a `<RequireRole role="PARENT" />` wrapper redirects to `/login` (or to `/lms` for a logged-in non-parent) before rendering parent-only routes.
- `apps/admin` boots into a login screen and gates everything behind `<RequireRole role="ADMIN" />`. A non-ADMIN authenticated user is shown the canonical "ADMIN only" message and a logout button — no data fetched.
- `apiClient` reads `IApiErrorResponse.code === 'AUTH_TOKEN_EXPIRED'` to drop the token and route to `/login` exactly once (no retry loop — see ADR 0006).

## Refresh token flows (ADR 0007)

> Added in M09. Full design lives in [adr/0007-refresh-token-rotation.md](./adr/0007-refresh-token-rotation.md). This section is the operational view — the sequence diagrams an implementer or reviewer needs to read the wire.

The "Request authentication flow" block above describes the **access-token** path; it remains accurate. What changes with ADR 0007:

- `POST /auth/login` and `POST /auth/signup` additionally issue a refresh cookie (`Set-Cookie: mes_rt=...; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`).
- New endpoints `POST /auth/refresh` and `POST /auth/logout` — both `@Public()` (JWT bearer not required; the cookie is the credential), both behind `OriginAllowedGuard` + `X-Requested-With` header check (CSRF defence, ADR 0007 §8).
- Access token TTL is now **10 minutes** (lowered from 15; see ADR 0003 amendment).
- Refresh token is opaque (256-bit random, base64url); hashed (`SHA-256`) on the server side and stored in `refresh_tokens`. The raw value lives only in the cookie.

### Login (issues access JWT + refresh cookie)

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (SPA)
    participant API as AuthController
    participant S as AuthService
    participant DB as refresh_tokens

    C->>API: POST /auth/login { email, password }
    API->>S: login(email, password)
    S->>S: argon2.verify
    S->>S: signJwt({ sub, role }, exp=10m)
    S->>S: rawRefresh = randomBytes(32).base64url
    S->>S: tokenHash = sha256(rawRefresh)
    S->>DB: INSERT (user_id, family_id=new uuid, token_hash, expires_at=now+7d, ua, ip)
    DB-->>S: ok (committed)
    S-->>API: { accessToken, rawRefresh }
    API-->>C: 200 { accessToken }<br/>Set-Cookie: mes_rt=<raw>; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
```

### Refresh — happy path (rotation) and grace-window legitimate retry

The two paths share the same entry point. Branching happens after the `SELECT … FOR UPDATE` reads the row.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant G as OriginAllowedGuard + X-Requested-With check
    participant API as AuthController
    participant S as AuthService
    participant DB as refresh_tokens

    C->>G: POST /auth/refresh<br/>Cookie: mes_rt=<raw><br/>X-Requested-With: XMLHttpRequest<br/>Origin: <allow-listed>
    G->>API: passes
    API->>S: refresh(rawToken, { ua, ip })
    S->>DB: BEGIN; SELECT row WHERE token_hash=sha256(raw) FOR UPDATE
    DB-->>S: row { revoked_at, replaced_by_id, family_id, expires_at, ua_original }

    alt revoked_at IS NULL AND not expired (happy path)
        S->>DB: INSERT new row (same family_id, fresh expires_at=now+7d, fresh ua/ip)
        S->>DB: UPDATE old SET revoked_at=now(), replaced_by_id=<new.id>
        S->>DB: COMMIT
        S->>S: accessToken = signJwt(...)
        S-->>API: { accessToken, rawNew, maxAge=604800 }
        API-->>C: 200 { accessToken }<br/>Set-Cookie: mes_rt=<new>; Max-Age=604800; ...
    else revoked AND (now() - revoked_at) < 10s AND ua matches (grace path)
        Note over S,DB: Legitimate retry — re-issue the successor verbatim.<br/>Successor's expires_at is NOT refreshed.
        S->>DB: SELECT successor row WHERE id=replaced_by_id
        DB-->>S: successor { rawHash, expires_at }
        S->>S: re-fetch the stored raw via in-memory cache?<br/>(See ADR 0007 §6 — the grace path returns the same successor)
        S->>DB: COMMIT (no writes)
        S-->>API: { accessToken, rawSuccessor, maxAge = expires_at - now() }
        API-->>C: 200 { accessToken }<br/>Set-Cookie: mes_rt=<successor>; Max-Age=<recomputed>; ...
    end
```

> **Implementation note on the grace path.** The successor's raw token value is only known at the moment of original rotation (we store its hash, not the raw). To re-emit the successor verbatim within the 10s grace window, the rotation handler caches `{ predecessor.id → successor.raw }` in-process with a TTL equal to `REFRESH_REUSE_GRACE_SECONDS`. After the window expires the cache entry drops, and any later replay falls through to the theft path. This is an implementation detail of the auth module; documented here so reviewers don't expect to find the raw successor in the database.

### Logout (revoke single token, not the whole family)

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant G as OriginAllowedGuard + X-Requested-With
    participant API as AuthController
    participant S as AuthService
    participant DB as refresh_tokens

    C->>G: POST /auth/logout<br/>Cookie: mes_rt=<raw><br/>X-Requested-With: XMLHttpRequest
    G->>API: passes
    API->>S: logout(rawToken)
    S->>DB: UPDATE refresh_tokens SET revoked_at=now()<br/>WHERE token_hash=sha256(raw) AND revoked_at IS NULL
    DB-->>S: affected = 0 or 1 (idempotent either way)
    S-->>API: ok
    API-->>C: 204 No Content<br/>Set-Cookie: mes_rt=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0
    Note over C,API: Cookie clear has attribute parity with the issuing cookie.<br/>Safari refuses to clear cookies with mismatched attributes (e2e asserts WebKit).
```

### Reuse-detection theft path (family revocation)

Fires when a revoked token arrives *outside* the grace window, *or* inside the grace window with a mismatched `user_agent`.

```mermaid
sequenceDiagram
    autonumber
    participant A as Attacker (replays stolen cookie)
    participant V as Victim (already rotated)
    participant API as AuthController
    participant S as AuthService
    participant DB as refresh_tokens
    participant L as logger

    V->>API: POST /auth/refresh (legitimate; rotates token N → N+1)
    API->>DB: rotate (N revoked, N+1 active)
    Note over V,DB: Some time passes — attacker captured token N earlier

    A->>API: POST /auth/refresh<br/>Cookie: mes_rt=<token N>
    API->>S: refresh(rawN, { ua_attacker, ip_attacker })
    S->>DB: BEGIN; SELECT row FOR UPDATE
    DB-->>S: row { revoked_at=set, replaced_by_id=N+1, ua_original }

    alt now() - revoked_at >= 10s OR ua_attacker != ua_original
        S->>DB: UPDATE refresh_tokens SET revoked_at=now()<br/>WHERE family_id=$1 AND revoked_at IS NULL
        S->>DB: COMMIT
        S->>L: warn { code: 'REFRESH_TOKEN_REUSED', userId, familyId, ipPrefix, uaMatch=false }
        S-->>API: throw RefreshTokenReusedError
        API-->>A: 401 { code: 'REFRESH_TOKEN_REUSED' }
        Note over V,API: Victim's next /auth/refresh now also fails — token N+1<br/>was revoked by the family-revocation update.<br/>Both attacker and victim are logged out.<br/>Victim re-logs; new family starts.
    end
```

The "victim collateral damage" is intentional: there is no way to distinguish attacker from victim from the tokens alone. We optimise for "kill the compromised session" over "keep the legitimate session online", because once the family is compromised every token in it is suspect.

## Secret rotation note

For this test task, `JWT_SECRET` is static per environment. To rotate in production we'd:

1. Introduce a `kid` (key id) header in newly-issued tokens.
2. Hold a small **allow-list** `{ kid -> secret }` server-side, populated from env.
3. Verify with the `kid`-selected secret. Tokens carrying a `kid` **not present in the allow-list** are rejected with `AUTH_INVALID_TOKEN` (401) — the verifier never falls back to a default secret. Tokens with no `kid` header are also rejected after cutover.
4. After the longest issued TTL elapses, the retired `kid` is removed from the allow-list.

Out of scope for v1, but the JWT header in the signer is the easy seam.

## Known limitations

### Refresh-token rotation concurrent-family deadlock window

When multiple simultaneous refresh requests arrive from the same token family (e.g., concurrent browser tabs, network retry loops), the `SELECT ... FOR UPDATE` lock on the predecessor can create a small window where both requests see the same predecessor row. The race is resolved by the unique constraint on `(user_id, family_id)` at insertion of the successor; one request will succeed and the other will fail. This is correct but observable under load. Future mitigation: pre-transaction conflict detection or queue-based rotation to serialize requests from the same family.

### Reuse-detection User-Agent strict equality on grace path

Token reuse detection uses an exact string match of the `User-Agent` header when deciding between grace-path replay (10s window) and theft-path family revocation. Browser updates can shift the UA mid-session (e.g., Chrome auto-update from 125.0 to 126.0), causing a mismatch and triggering family revocation even though the session is legitimate. The grace window (10s) mitigates in practice because most legitimate retries occur immediately. Future mitigation: hash the UA to a family (e.g., `Chrome 125.x`, ignoring patch version) instead of strict equality.

## See also

- [overview.md](./overview.md)
- [data-model.md](./data-model.md) — `users` table
- [adr/0003-jwt-stateless-auth.md](./adr/0003-jwt-stateless-auth.md)
- [adr/0005-logging-and-error-handling.md](./adr/0005-logging-and-error-handling.md) — canonical error shape + redaction
- [adr/0006-retries-and-idempotency.md](./adr/0006-retries-and-idempotency.md) — 401 handling on frontend
