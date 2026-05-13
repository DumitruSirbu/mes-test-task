# ADR 0005 — Logging & Error Handling

> Status: draft. Finalised in M02 by `mes-architect`.

## Context

Logs and errors are the operator's first interface to the system. The team wants them structured, redacted, and consistent.

## Decision

**Backend:**
- `nestjs-pino` + `pino` for structured JSON logs (pretty in dev via `pino-pretty`).
- `nestjs-cls` middleware attaches a request-scoped `requestId` (UUID) to every log line; honour incoming `x-request-id` if present.
- BullMQ processors carry a `jobId`-derived correlation id.
- `redact` config: `password`, `token`, `authorization`, `jwt`; partial redaction on `email`.
- `DomainException` base class with stable `code` and HTTP status; concrete subclasses per business error.
- Global `AllExceptionsFilter` produces the canonical JSON response:
  ```json
  { "code": "...", "message": "...", "requestId": "...", "details": {} }
  ```
  Logs `warn` for 4xx, `error` for 5xx + unexpected throws. Hides stack traces in non-dev responses; always includes in logs.
- `ValidationPipe`: `whitelist: true, forbidNonWhitelisted: true, transform: true`. Validation errors mapped to `code: VALIDATION_FAILED` with `details.fields`.
- `@nestjs/terminus`: `/health/live` and `/health/ready` (Postgres + Redis).

**Frontend:**
- Root React `ErrorBoundary` with `requestId`-aware fallback.
- `apiClient` parses the backend error shape into a typed `ApiError`.
- TanStack Query `QueryCache`/`MutationCache` `onError`: toast in prod, console in dev, 401 → logout.
- ESLint `no-console: ["warn", { allow: ["warn", "error"] }]`.

## Consequences

- ✅ Every error has a stable `code` the frontend can branch on.
- ✅ Logs never leak secrets.
- ✅ One canonical error shape across the API.

## Alternatives considered

- **Winston.** Equally good; pino wins on speed + ergonomic redact config in our stack.
- **No structured logging (console).** Rejected — kills future observability.
