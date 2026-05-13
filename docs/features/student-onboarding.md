# Feature — Student Onboarding & Activation

> **Status:** shipped in M05. Student opens invitation link → onboarding form → authenticated as STUDENT, redirected to `/lms`.

## Goal

A student receives an invitation URL from a parent who has purchased course access. The student opens the link, enters personal details and a password, and is immediately authenticated and redirected into the LMS.

## Surface

### Backend

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/invitations/:token/meta` | Public | Returns invitation metadata (course title, parent email, student email, expiry date). Token is redacted from logs. Returns 410 if expired / already redeemed / invalid. |
| POST | `/invitations/redeem` | Public | Validates token, creates STUDENT user, creates enrolment, marks invitation REDEEMED, returns JWT. Atomic transaction. All failure paths return HTTP 410. |

### Frontend (`apps/web`)

| Route | Purpose |
|---|---|
| `#/onboard/:token` | Landing page + onboarding form. Fetches metadata from `GET /invitations/:token/meta`, displays course/parent context. Form collects firstName, lastName, dateOfBirth, password, passwordConfirm. Validates against `redeemInvitationSchema` (Zod client + RHF). On success, stores JWT in `authStore`, redirects to `#/lms`. |
| `#/lms` | Stub page (rendered for authenticated STUDENT users). Full implementation in M06. |

## Request/response shapes

### `GET /invitations/:token/meta`

**Response (200):**
```json
{
  "courseTitle": "Mathematics (Year 5)",
  "parentEmail": "parent@example.com",
  "studentEmail": "student@example.com",
  "expiresAt": "2026-05-27T19:45:00.000Z",
  "status": "ISSUED"
}
```

Fields:
- `status`: enum `ISSUED`, `REDEEMED` — allows frontend to show contextual messaging (e.g., "This invitation has been used" for REDEEMED).

**Error responses:**
- **410 INVITATION_NOT_FOUND** — token not found
- **410 INVITATION_EXPIRED** — token expired
- **410 INVITATION_ALREADY_REDEEMED** — token already redeemed

All errors return the same HTTP 410 status (oracle-resistant per ADR 0005).

### `POST /invitations/redeem`

**Request:**
```json
{
  "token": "<plaintext_token>",
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "2010-03-15",
  "password": "SecureP@ssw0rd",
  "confirmPassword": "SecureP@ssw0rd"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

**Error responses:**
- **400 VALIDATION_FAILED** — schema validation failed; includes `details.fields` array
- **410 INVITATION_NOT_FOUND** — token not found
- **410 INVITATION_EXPIRED** — token expired
- **410 INVITATION_ALREADY_REDEEMED** — token already redeemed
- **410 INVITATION_EMAIL_CONFLICT** — email already registered (oracle-resistant)

All domain errors return HTTP 410 unless validation fails (400).

## Domain exceptions

All thrown by `InvitationsService.redeem()`. All HTTP 410 except `ValidationFailedError`.

- **`InvitationNotFoundError`** — token not in DB
- **`InvitationExpiredError`** — `expires_at < now()`
- **`InvitationAlreadyRedeemedError`** — `status !== ISSUED`
- **`InvitationEmailConflictError`** — student email already registered to a user (transactional race edge case)

Each carries a stable `code` property (e.g., `'INVITATION_EXPIRED'`) for client error mapping.

## Backend implementation

### `InvitationsService.redeem(token, firstName, lastName, dateOfBirth, password)`

Executes in a single TypeORM transaction:

1. **Hash token** — SHA-256 of the plaintext token.
2. **Lookup** — fetch invitation by `token_hash`; throw `InvitationNotFoundError` if missing.
3. **Validate status** — check `status = ISSUED` and `expires_at > now()`; throw `InvitationExpiredError` or `InvitationAlreadyRedeemedError` as appropriate.
4. **Create user** — INSERT into `users` (email, hashed password, role `STUDENT`). If UNIQUE constraint fires on email, throw `InvitationEmailConflictError`.
5. **Fetch course** — load course ID from the originating purchase (follows purchase FK).
6. **Create enrolment** — INSERT into `enrolments` (student_id, course_id, status `ACTIVE`, enrolled_at `now()`).
7. **Mark redeemed** — UPDATE invitation to `status = REDEEMED`, `redeemed_at = now()`.
8. **Return JWT** — sign a token for the new student with claims: `sub`, `role: STUDENT`, standard `iat`/`exp`.

If any step fails, the transaction rolls back (zero partial state).

### `GET /invitations/:token/meta`

1. Hash the token.
2. Lookup by `token_hash`.
3. If found, fetch related purchase & course; return metadata (title, parent email, student email, expiry).
4. On any miss or status issue, return 410 (does not distinguish reason per ADR 0005).
5. **Token redaction in logs** — the plaintext token is never logged; only the hash is used in query logs.

### Request validation

- **Schema:** `redeemInvitationSchema` (in shared) — Zod validator enforcing:
  - `token`: non-empty string, 1–1000 chars (base64url encoding overhead)
  - `firstName`, `lastName`: 1–100 chars each
  - `dateOfBirth`: ISO date string (YYYY-MM-DD), parseable as valid Date
  - `password`: 8–128 chars, must contain uppercase + lowercase + number + special char
  - `confirmPassword`: must equal `password`
- **Server-side re-validation** — NestJS `@Body(...)` pipe runs Zod schema again before handler
- **Field errors** — returned as `{ code: 'VALIDATION_FAILED', details: { fields: [{ path: 'password', message: 'too short' }] } }`

## Database

### Migrations

| Order | File | Adds |
|---|---|---|
| 7 | `20260513160000-CreateEnrolmentsTable.ts` | `enrolments` table (student_id FK → users, course_id FK → courses, status `active`, enrolled_at timestamp, updated_at timestamp). Composite unique on (student_id, course_id) — no duplicate enrolment. |

### Enrolments table schema

```sql
CREATE TABLE enrolments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'active',  -- 'active', future-proofing for suspend/archive
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, course_id)
);

CREATE INDEX ON enrolments(student_id);
CREATE INDEX ON enrolments(course_id);
CREATE INDEX ON enrolments(status);
```

## Frontend implementation

### `/onboard/:token` route

1. Extract `:token` from URL params.
2. On mount, call `GET /invitations/:token/meta` (loading state).
3. On success, display landing page:
   - "Welcome to [Course Title]"
   - "Invitation from [Parent Email]"
   - "Expires: [Date]"
   - Onboarding form (below)
4. On error (410 / timeout):
   - Display error message ("This invitation has expired or is invalid. Contact [parent email].")
   - Hide form.

### Onboarding form

**Tech stack:** React Hook Form + Zod (zodResolver).

**Fields:**
- firstName (text, required, 1–100 chars)
- lastName (text, required, 1–100 chars)
- dateOfBirth (date picker, required, valid ISO date, ≥ 4 years old as per school enrolment rules — configurable)
- password (password field, required, strength validation inline)
- confirmPassword (password field, required, must match)

**Client-side validation:**
- Schema: `redeemInvitationSchema` via Zod
- RHF displays field-level errors inline (red text under each field)
- Form submit button disabled while form invalid or API call in flight

**Server-side validation:**
- Returns 400 `VALIDATION_FAILED` with `details.fields` on schema mismatch
- Frontend parses response, maps errors to RHF form state by field path

**Submit handler:**
1. Validate local schema (RHF blocks if invalid).
2. POST to `/invitations/redeem` with form data + token.
3. On 200, extract `access_token` from response.
4. Write to `authStore.setToken(token)` (localStorage-backed).
5. Redirect to `#/lms`.
6. On error, display error message:
   - 400 `VALIDATION_FAILED` → list field errors
   - 410 `INVITATION_EXPIRED` / `INVITATION_ALREADY_REDEEMED` → "This invitation is no longer valid"
   - Network error → "Connection failed, please try again"

### `/lms` route

Displays student's enrolled courses (retrieved from backend `GET /me/courses`). Clicking a course navigates to `/lms/courses/:id`.

Visible only if `authStore.isAuthenticated && authStore.user.role === UserRoleEnum.STUDENT`. Unauthenticated users redirected to `/login`.

## Shared package additions

### `packages/shared/src/schemas/redeemInvitationSchema.ts`

```typescript
export const redeemInvitationSchema = z.object({
  token: z.string().min(1).max(1000),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().refine((val) => {
    // ISO YYYY-MM-DD format
    const date = new Date(val);
    return !isNaN(date.getTime()) && date < new Date();
  }, "Invalid date of birth"),
  password: z.string()
    .min(8)
    .max(128)
    .refine((val) => /[A-Z]/.test(val), "Must contain uppercase")
    .refine((val) => /[a-z]/.test(val), "Must contain lowercase")
    .refine((val) => /[0-9]/.test(val), "Must contain digit")
    .refine((val) => /[^A-Za-z0-9]/.test(val), "Must contain special char"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export type RedeemInvitationRequest = z.infer<typeof redeemInvitationSchema>;
```

### `packages/shared/src/types/IInvitationMetaResponse.ts`

```typescript
export interface IInvitationMetaResponse {
  courseTitle: string;
  parentEmail: string;
  studentEmail: string;
  expiresAt: string; // ISO 8601 timestamp
  status: "ISSUED" | "REDEEMED"; // invitation status
}
```

### `packages/shared/src/types/IAuthTokenResponse.ts`

```typescript
export interface IAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number; // seconds
}
```

## Testing

### Backend

**Unit tests** (`InvitationsService.spec.ts`):
- Happy path: valid token, creates user + enrolment, returns JWT (4 assertions)
- Expired token → throws `InvitationExpiredError` (1 assertion)
- Already redeemed → throws `InvitationAlreadyRedeemedError` (1 assertion)
- Invalid token → throws `InvitationNotFoundError` (1 assertion)
- Email conflict (transactional race) → throws `InvitationEmailConflictError` (1 assertion)
- Password validation on input (4 variations) → 2 assertions per case (8 total)

**E2E tests** (`invitations.e2e-spec.ts`):
- Happy path: `GET /invitations/:token/meta` → 200 + metadata shape (2 assertions)
- Happy path: `POST /invitations/redeem` → 200 + JWT in response (2 assertions)
- Expired token on both endpoints → 410 (2 assertions)
- Already redeemed on both endpoints → 410 (2 assertions)
- Invalid token on both endpoints → 410 (2 assertions)
- Malformed dateOfBirth → 400 (1 assertion)
- Weak password → 400 (1 assertion)

**Total: 9 backend e2e + unit passing.**

### Frontend

**Component tests** (`OnboardPage.spec.tsx`):
- Mount with valid token → calls `GET /invitations/:token/meta`, renders form + metadata (2 assertions)
- Expired token response → shows error, hides form (1 assertion)
- Form validation — password mismatch → button disabled (1 assertion)
- Form submission happy path → calls `POST /invitations/redeem`, stores JWT, navigates to `/lms` (3 assertions)
- Server validation error (400) → displays field errors (2 assertions)
- Server oracle error (410) → displays generic error message (1 assertion)

**Total: 11 frontend unit tests passing.**

## What's deferred (carry-overs to M06)

- **Argon2 timing oracle on failure paths** — password hash is computed before transaction (observable timing delta between user-not-found vs password-mismatch). Documented per ADR 0005; mitigation in M06 (constant-time dummy hash or pre-hashing at lookup boundary).
- **Rate limiting on public endpoints** — `GET /invitations/:token/meta` and `POST /invitations/redeem` are unauthenticated; absent rate limiting in v1. M06 to add `@Throttle(limit, ttl)` decorator.
- **Real-date validation for dateOfBirth** — accepts any ISO date in the past; no school-age check (5–18 yr old per curriculum policy). M06 to validate against school year policy.
- **BaseRepository bypass in invitations repo** — `findOne` does not support token_hash lookup; repo implements custom `findByTokenHash` with raw SQL. M06 will abstract into repo method or QueryBuilder helper.
- **Error code constants not in shared** — codes live in `InvitationsService` const block, not `@mes/shared`. M06 to centralize alongside domain error definitions.

## See also

- [Architecture overview](../architecture/overview.md)
- [Data model — `invitations`, `enrolments`](../architecture/data-model.md)
- [Auth & RBAC](../architecture/auth-and-rbac.md)
- [ADR 0005 — HTTP status code oracle resistance](../architecture/adr/0005-http-status-code-strategy.md)
- [Code conventions](../best-practices/code-conventions.md)
