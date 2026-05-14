# ADR 0003 — Stateless JWT Authentication

- **Status:** Accepted (2026-05-13) · **Superseded in part by [ADR 0007](./0007-refresh-token-rotation.md)** (2026-05-14)
- **Deciders:** mes-architect, mes-orchestrator; reviewed by `mes-review-security`
- **Tags:** auth, security

> **Amendment (2026-05-14):** Superseded in part by [ADR 0007 — Refresh Token Rotation](./0007-refresh-token-rotation.md). The "in-memory access token only, no refresh" stance and the 15-minute access TTL are replaced by a short-lived access token (TTL lowered **15 → 10 minutes**) paired with an opaque refresh token in an httpOnly cookie, rotated on every use. The `Authorization: Bearer` transport for the access token, HS256 algorithm pin, 32-byte secret minimum, and error-code mappings below remain in force. Original rationale preserved below.

## Context

We need an auth mechanism for three roles (parent, student, admin) that:

- Carries enough context to enforce RBAC on every request without a DB lookup on the hot path.
- Works across two SPAs (`apps/web`, `apps/admin`) on different origins.
- Fits the 3–4 hour budget — no integration with a third-party identity provider.
- Survives the assignment's "no real auth system required" framing while still demonstrating defensible security choices.

## Decision

Issue **HS256 JSON Web Tokens** signed with a server-side secret (`JWT_SECRET`). Tokens carry only `{ sub, role, iat, exp }` — no PII. Transport is `Authorization: Bearer <token>` only (no cookies).

- **Access token TTL:** 15 minutes (env-tunable via `JWT_EXPIRES_IN`).
- **Refresh tokens:** **out of scope for v1.** Documented as a "Next steps" item in the README.
- **Frontend token storage:** **in-memory only** (React context / store). No `localStorage`, no `sessionStorage`, no cookies. Rationale: an XSS payload that defeats our CSP can execute scripts but cannot enumerate browser storage to exfiltrate a long-lived token. The trade-off is that a page reload forces re-login — acceptable for v1 because there is no refresh token to lose. On `AUTH_TOKEN_EXPIRED` (401) the apiClient drops the in-memory token and routes to `/login` exactly once.
- **Secret minimum:** 32 bytes. Backend boot fails fast if `JWT_SECRET` is missing or shorter.
- **Algorithm pinning (non-negotiable):** the verifier configuration MUST pass `algorithms: ['HS256']` to `JwtStrategy` (and `JwtModule.register({ verifyOptions: { algorithms: ['HS256'] } })`). Tokens carrying any other `alg` — including `none` and `RS256` — are rejected with `AUTH_INVALID_TOKEN`. This blocks the well-known `alg`-confusion family of bypasses.
- **Verification:** delegated to `passport-jwt` via `@nestjs/passport`. A custom `JwtStrategy` validates and shapes the payload into `IAuthenticatedUser`.
- **No revocation list.** Compromised tokens remain valid until expiry. Mitigated by the 15-minute TTL.
- **`JWT_SECRET` provisioning:** generated per environment and provided via Docker compose env. Never committed.
- **Rotation procedure** (documented, not implemented in v1): add a `kid` to issued tokens; verifier holds an **allow-list** `{ kid -> secret }` and rejects unknown `kid`s with `AUTH_INVALID_TOKEN`. See `auth-and-rbac.md` "Secret rotation note" for the full procedure.
- **Failure → error code mapping:** missing header → `AUTH_MISSING_TOKEN` (401); bad signature, wrong `alg`, or unknown `kid` → `AUTH_INVALID_TOKEN` (401); expired → `AUTH_TOKEN_EXPIRED` (401); wrong role → `AUTH_FORBIDDEN_ROLE` (403). See the canonical error code table in `auth-and-rbac.md`.

## Consequences

**Positive:**

- Stateless: any backend instance verifies any token. Horizontally scalable from day one.
- Trivial to test: the integration suite can mint tokens via the same signing path.
- No session store, no Redis-backed session lookup on every request (Redis is still in the stack but only as the BullMQ broker, not on the auth hot path).
- Frontend logout drops the in-memory token — no server round trip.

**Negative / acknowledged trade-offs:**

- **No server-side logout.** A user who clicks "Logout" can have their old token replayed within the 15-minute window if it leaked. Mitigation: short TTL + HTTPS in any real deploy + `Authorization` header (not cookie) so no CSRF surface.
- **No forced password reset propagation.** Changing a password does not invalidate already-issued tokens. Acceptable at this scope; the README "Next steps" calls out a token-version column or revocation list as the canonical upgrade.
- **Token theft is fatal until expiry.** Same mitigation: short TTL. If we later add refresh tokens, they live in HTTP-only secure cookies with a CSRF token pattern.

## Alternatives considered

### Session cookies with a server-side store

Slightly safer revocation story (delete the session row → instant logout). Rejected because:

- Adds a session store (Redis or DB) on the auth hot path.
- Forces a CSRF token pattern in both SPAs.
- The "no real auth system" framing of the brief doesn't justify the extra complexity.

### Refresh token rotation in v1

Considered. The pattern is well-known (short access token + long-lived refresh token + rotation on every refresh + reuse detection). Rejected for v1 only on time grounds — implementing it correctly (rotation, reuse detection, secure cookie, CSRF) is a multi-hour task that doesn't change the demo. Explicitly flagged as the first v2 feature.

### OAuth provider (Clerk, Auth0, Supabase Auth)

Rejected. Out of scope per the brief.

### RS256 instead of HS256

Asymmetric signing would let a separate service verify tokens without the signing secret. We have one service. Rejected as overkill for the scope.

## See also

- [../auth-and-rbac.md](../auth-and-rbac.md)
- [0005-logging-and-error-handling.md](./0005-logging-and-error-handling.md) — error codes
- [0006-retries-and-idempotency.md](./0006-retries-and-idempotency.md) — frontend's "no retry loop on 401" rule
