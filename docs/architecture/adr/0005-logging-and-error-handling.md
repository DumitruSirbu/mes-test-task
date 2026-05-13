# ADR 0005 — Logging & Error Handling

- **Status:** Accepted (2026-05-13)
- **Deciders:** mes-architect, mes-orchestrator; reviewed by `mes-review-security` (redaction) and `mes-review-logic` (error shape)
- **Tags:** observability, error-handling, security

## Context

Logs and errors are the operator's first interface to the system. We want them:

- **Structured** — searchable, parseable JSON in non-dev environments; pretty in dev.
- **Correlated** — every line within a request traces back to a single `requestId`.
- **Safe** — no secrets, tokens, or full emails leak into logs.
- **Consistent** — every API error has the same shape so the frontend can branch on a stable `code` rather than a human message.

The brief explicitly weights error-handling and observability discipline; this ADR locks the policy so every later milestone cites it instead of reinventing.

## Decision

### Backend

- **Logger:** `nestjs-pino` wrapping `pino`. JSON output in `NODE_ENV=production`; `pino-pretty` transport in dev.
- **Request correlation:** `nestjs-cls` middleware allocates a UUID `requestId` per inbound request and stores it in AsyncLocalStorage. If the request carries `x-request-id`, we honour the incoming value (so an API gateway / load balancer can propagate a trace id end-to-end). Every log line includes `requestId`. BullMQ processors set `requestId = \`job:<jobId>\`` via the same CLS service.
- **Redaction (pino `redact` config):**
  - Full redact (`paths`, `censor: '[REDACTED]'`):
    `password`, `passwordHash`, `password_hash`,
    `secret`, `apiKey`,
    `token`, `accessToken`, `jwt`, `invitationToken`,
    `invitationUrl`, `*.invitationUrl`,
    `authorization`, `cookie`, `set-cookie`,
    `req.body.password`, `req.headers.authorization`, `req.headers.cookie`,
    `*.recipientEmail`.

    The `invitationUrl` redaction is defence-in-depth: the URL embeds the plaintext invitation token (the only place it ever exists outside the email), so any log line that accidentally captures the BullMQ job payload, the producer's pre-enqueue object, or a stack-trace local would otherwise leak a live single-use token. The token MUST NOT reach a log line in any form — not the full URL, not the token segment alone.
  - Partial redact for `email` — keep the domain, mask the local-part (e.g., `s***@example.com`).
  - The full body stored in `idempotency_keys.response_body` is **never logged** at any level — even at debug — because for the purchase endpoint it may have once carried the invitation URL. See ADR 0006: per the updated decision the stored body now carries only `{ purchaseId, invitationId }`, but the redaction rule is kept defence-in-depth.
- **Validation:** global `ValidationPipe` with `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`. Validation failures map to `code: VALIDATION_FAILED` with `details.fields: { field: [reasons...] }`.
- **Exception filter:** global `HttpExceptionFilter` (`APP_FILTER`), implemented as a Nest `ExceptionFilter`. Produces the canonical error shape:

  ```json
  {
      "code": "INVITATION_EXPIRED",
      "message": "This invitation has expired.",
      "requestId": "c0ffee...",
      "details": {}
  }
  ```

  - 4xx → `logger.warn` with `{ code, requestId, path, userId? }`.
  - 5xx and unexpected throws → `logger.error` with full stack trace in the log; response carries `code: INTERNAL_ERROR` with a generic message — never the stack.
  - Stack traces always go to logs; never to the HTTP response in non-dev.
  - Mapping rules (in order):
      1. `err instanceof DomainError` → `{ code: err.code, message: err.message, details: err.details, requestId }`; `response.status(err.httpStatus)`. The `err.cause` (if present) is logged but never sent in the response.
      2. `err instanceof UnauthorizedException` (Nest built-in, e.g. from `JwtAuthGuard`) → normalised to `{ code: 'AUTH_INVALID_TOKEN' | 'AUTH_MISSING_TOKEN' | 'AUTH_TOKEN_EXPIRED', ... }` at HTTP 401. The specific code is chosen from the underlying passport / jwt-strategy error.
      3. `err instanceof ForbiddenException` (Nest built-in, e.g. from `RolesGuard`) → normalised to `{ code: 'AUTH_FORBIDDEN_ROLE', ... }` at HTTP 403.
      4. `err instanceof ThrottlerException` → `{ code: 'RATE_LIMITED', ... }` at HTTP 429.
      5. `err instanceof BadRequestException` produced by `ValidationPipe` → `{ code: 'VALIDATION_FAILED', details: { fields: ... } }` at HTTP 400.
      6. Anything else → `logger.error(err)`; respond with `{ code: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId }` at HTTP 500. The original message and stack are kept in the log only.

### Domain errors

The canonical error-handling primitive on the backend is a plain `Error` subclass — **not** a Nest `HttpException`. The HTTP concern (status code, JSON serialisation) lives in the global filter; services and repositories speak the domain language and throw typed errors.

- **Base class:** `DomainError extends Error` (in `apps/backend/src/common/error/DomainError.ts`).
- **Rule:** services and repositories MUST throw `DomainError` subclasses. Controllers MUST NOT throw `HttpException` (or `BadRequestException`, `NotFoundException`, etc.) directly — that pattern scatters HTTP concerns across business logic and bypasses the canonical JSON shape. The only places `HttpException` legitimately appears are: Nest built-in guards (handled by the filter mapping above), the `ValidationPipe` (also handled by mapping), and the throttler (also handled).
- **Why `extends Error` and not `extends HttpException`:** keeps the service layer free of any `@nestjs/common` import in its error path, lets the same error types be reused by BullMQ processors / CLI scripts / tests without dragging Nest's HTTP machinery in, and makes the filter the single point that knows how to render an HTTP response. The Clean Code Ch.7 guidance ("wrap third-party errors in your own domain exception types") applies equally to NestJS itself.

Base class shape. Naming follows `code-conventions.md`: `DomainError` is a class (no `I`-prefix; the `Error` suffix is the agreed marker for the exception family); `IDomainErrorOptions` is its constructor-options interface and therefore takes the `I`-prefix per the conventions doc. Classes use 4-space indent and named DTOs for any structured `details`.

```ts
// apps/backend/src/common/error/DomainError.ts
export interface IDomainErrorOptions {
    httpStatus: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
}

export abstract class DomainError extends Error {
    public readonly code: string;
    public readonly httpStatus: number;
    public readonly details?: Record<string, unknown>;
    public readonly cause?: unknown;

    protected constructor(options: IDomainErrorOptions) {
        super(options.message);
        this.name = new.target.name;
        this.code = options.code;
        this.httpStatus = options.httpStatus;
        this.details = options.details;
        this.cause = options.cause;
        Error.captureStackTrace?.(this, new.target);
    }
}
```

Example concrete subclass:

```ts
// apps/backend/src/invitations/error/InvitationExpiredError.ts
export class InvitationExpiredError extends DomainError {
    public constructor(invitationId: number) {
        super({
            httpStatus: 410,
            code: 'INVITATION_EXPIRED',
            message: 'This invitation has expired.',
            details: { invitationId },
        });
    }
}
```

Wrapping a third-party / DB error (Clean Code Ch.7):

```ts
try {
    await this.purchasesRepository.insert(row);
} catch (cause) {
    if (isUniqueViolation(cause)) {
        throw new IdempotencyKeyReusedError({ key: row.idempotencyKey, cause });
    }
    throw cause; // unexpected — let the filter map to INTERNAL_ERROR
}
```

### Canonical v1 subclasses

One class per canonical error code. The filter switches purely on `instanceof DomainError` and reads `code` / `httpStatus` off the instance — it does **not** maintain a code-to-status lookup table.

| Class | HTTP | `code` |
|---|---|---|
| `InvitationNotFoundError` | 410 | `INVITATION_NOT_FOUND` |
| `InvitationExpiredError` | 410 | `INVITATION_EXPIRED` |
| `InvitationAlreadyRedeemedError` | 410 | `INVITATION_ALREADY_REDEEMED` |
| `InvitationEmailConflictError` | 410 | `INVITATION_EMAIL_CONFLICT` |
| `IdempotencyKeyRequiredError` | 400 | `IDEMPOTENCY_KEY_REQUIRED` |
| `IdempotencyKeyReusedError` | 409 | `IDEMPOTENCY_KEY_REUSED` |
| `IdempotencyBodyMismatchError` | 409 | `IDEMPOTENCY_BODY_MISMATCH` |
| `CourseNotFoundError` | 404 | `COURSE_NOT_FOUND` |
| `LessonNotFoundError` | 404 | `LESSON_NOT_FOUND` |
| `EnrolmentNotFoundError` | 404 | `ENROLMENT_NOT_FOUND` |
| `EnrolmentAlreadyExistsError` | 409 | `ENROLMENT_ALREADY_EXISTS` |
| `ValidationFailedError` | 400 | `VALIDATION_FAILED` |
| `RateLimitedError` | 429 | `RATE_LIMITED` |
| `UnauthorizedError` | 401 | `AUTH_INVALID_TOKEN` / `AUTH_MISSING_TOKEN` / `AUTH_TOKEN_EXPIRED` / `AUTH_INVALID_CREDENTIALS` (sub-code chosen at construction) |
| `ForbiddenError` | 403 | `AUTH_FORBIDDEN_ROLE` |
| `UserEmailTakenError` | 409 | `USER_EMAIL_TAKEN` |

`IDEMPOTENCY_REPLAY` is not in this table — it is not an error condition. The interceptor replays the stored response verbatim and emits an `info` log line tagged with that code (see ADR 0006).

`INTERNAL_ERROR` is also not in this table — it is the filter's fallback when no `DomainError` was thrown.

- **Third-party / DB errors** are wrapped in a `DomainError` subclass at the service boundary, with the original error passed as `cause` for logs — the raw `QueryFailedError` never reaches the filter. Reason: we don't want Postgres constraint names leaking into API responses.
- **Health endpoints:** `@nestjs/terminus` provides `GET /health/live` (process up) and `GET /health/ready` (Postgres ping + Redis ping). Both `@Public()`.

### Frontend

- **Root `ErrorBoundary`** in both `apps/web` and `apps/admin`. Fallback UI shows the `requestId` so the user can quote it in a support message.
- **`apiClient`** parses the backend error shape into a typed `ApiError` (`{ code, message, requestId, details, status }`). UI branches on `code`, never on `message`.
- **TanStack Query** `QueryCache.onError` and `MutationCache.onError`:
  - In dev: `console.error` the `ApiError`.
  - In prod: render a toast (Sonner) using a human message keyed off `code`; fall back to a generic "Something went wrong" with the `requestId`.
  - `code === 'AUTH_TOKEN_EXPIRED'` → drop token, redirect to `/login` exactly once.
- **ESLint** `no-console: ['warn', { allow: ['warn', 'error'] }]` — no stray `console.log` in committed code.

## Consequences

**Positive:**

- One canonical error shape across the API. The frontend's branching surface is a small enum of `code`s, not a free-form `message`.
- Logs are searchable by `requestId` end-to-end: ingress → service → repository → enqueue → processor.
- Redaction is configured once and enforced by the library, not by reviewer vigilance.
- Health checks let the orchestrator (and `docker compose healthcheck`) decide readiness based on real dependency state.

**Negative:**

- Pino's redact paths must be kept in sync with new fields — a reviewer checklist item.
- The "wrap third-party errors at the boundary" rule is enforced by convention, not by the type system. The clean-code review must look for raw `QueryFailedError`s escaping.

## Alternatives considered

### Winston

Equally good logger. Pino wins on raw throughput and on the `redact` API — Winston requires custom format middleware to do the same job.

### No structured logging (console)

Rejected. Forces every reviewer to parse free-text logs. Kills any future observability story (Loki, Datadog, etc.).

### NestJS built-in `Logger` only

Provides level-coloured strings but no JSON, no request correlation, no redaction. Used for a `Logger(MyService.name)`-style class logger that delegates to pino under the hood — i.e., the surface stays familiar even though the transport is pino.

### Returning error codes inline (no exceptions)

Rejected. The codebase relies on NestJS's exception filter mechanism; per `code-conventions.md` and the global clean-code rules, we throw and let the filter format.

### `DomainError extends HttpException` (instead of `extends Error`)

Rejected. Extending `HttpException` would bind every service-layer error to `@nestjs/common`, making the same error types awkward to reuse in BullMQ processors, CLI scripts, and unit tests that don't bootstrap Nest. It also encourages controllers and services to think in HTTP terms ("throw a 410") instead of domain terms ("invitation expired"). Keeping `DomainError` as a plain `Error` puts the HTTP translation at exactly one seam — the filter — and matches the Clean Code Ch.7 advice to keep domain exceptions decoupled from framework details.

### Throwing built-in `HttpException` subclasses from services (e.g. `throw new BadRequestException(...)`)

Rejected at the service layer. Scatters HTTP status decisions across business logic, makes the canonical JSON shape harder to enforce (each call site can pass a string or an object), and provides no `code` discriminator for the frontend. Built-in `HttpException`s are still legitimate **inside guards / interceptors / pipes** (Nest expects them there); the filter normalises them to the canonical shape on the way out.

## See also

- [../async-jobs.md](../async-jobs.md) — `requestId` propagation into jobs
- [../auth-and-rbac.md](../auth-and-rbac.md) — auth error code list
- [0006-retries-and-idempotency.md](./0006-retries-and-idempotency.md) — frontend retry / 401 handling
- [../../best-practices/code-conventions.md](../../best-practices/code-conventions.md) — error-handling rules
