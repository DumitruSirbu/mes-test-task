# MES Backend API Reference

**Maintenance Rule:** Every milestone that adds, changes, or removes an endpoint MUST update this file as part of the scribe's post-implementation task. Update the appropriate section, add error codes if new, and re-validate the examples against the actual implementation before closure.

---

## Overview

**Base URL:** `http://localhost:3000` (local development)

**Authentication:** Bearer JWT in the `Authorization` header.
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Standard Error Envelope** (all error responses, 4xx/5xx):
```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable message.",
  "requestId": "unique-request-uuid",
  "details": {}
}
```

The frontend branches on `code`, never on HTTP status or message text. See [Error Reference](#error-reference) for the full error code catalog.

**Idempotency:** Endpoints marked as idempotent require the `Idempotency-Key` header (UUID or string; see ADR 0006). The backend stores the response keyed by `(endpoint, idempotency-key, request-body-hash)` and returns the cached response on retry.

---

## Auth

### POST /auth/signup

Create a new parent account.

**Auth:** Public

**Idempotent:** No

**Request body:**

| Field     | Type   | Rules                                                   |
|-----------|--------|---------------------------------------------------------|
| email     | string | Valid email, max 255 chars; trimmed & lowercased       |
| password  | string | 12–128 chars; at least one letter + one digit         |
| firstName | string | Optional; max 80 chars                                  |
| lastName  | string | Optional; max 80 chars                                  |

**Example:**
```json
{
  "email": "parent@example.com",
  "password": "SecurePass123",
  "firstName": "Alice",
  "lastName": "Smith"
}
```

**Response `201`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 400  | `VALIDATION_FAILED` | Email invalid, password too short, etc. (see `details.fields`) |
| 409  | `USER_EMAIL_TAKEN` | Email already registered. |

---

### POST /auth/login

Authenticate a parent and obtain an access token.

**Auth:** Public

**Idempotent:** No

**Request body:**

| Field    | Type   | Rules                              |
|----------|--------|-----------------------------------|
| email    | string | Valid email, max 255 chars; trimmed & lowercased |
| password | string | 1–128 chars                       |

**Example:**
```json
{
  "email": "parent@example.com",
  "password": "SecurePass123"
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 400  | `VALIDATION_FAILED` | Email invalid, password too short, etc. |
| 401  | `AUTH_INVALID_CREDENTIALS` | Email not found or password mismatch. |

---

### GET /auth/me

Fetch the authenticated user's profile.

**Auth:** Bearer JWT (any role: PARENT or STUDENT)

**Idempotent:** N/A (GET)

**Request headers:** (none beyond standard `Authorization`)

**Response `200`:**
```json
{
  "id": 1,
  "email": "parent@example.com",
  "role": "PARENT",
  "firstName": "Alice",
  "lastName": "Smith"
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 401  | `AUTH_MISSING_TOKEN` | Authorization header missing or malformed. |
| 401  | `AUTH_INVALID_TOKEN` | Token signature invalid or unknown algorithm. |
| 401  | `AUTH_TOKEN_EXPIRED` | Token `exp` claim is past current time. |

---

## Courses

### GET /courses

List all available courses (public catalog). Anon users can browse.

**Auth:** Public

**Idempotent:** N/A (GET)

**Response `200`:**
```json
[
  {
    "id": 1,
    "subject": "MATHEMATICS",
    "yearFrom": 9,
    "yearTo": 11,
    "title": "GCSE Mathematics",
    "pricePence": 19900
  },
  {
    "id": 2,
    "subject": "ENGLISH",
    "yearFrom": 9,
    "yearTo": 11,
    "title": "GCSE English Language",
    "pricePence": 14900
  }
]
```

Fields:
- `id`: unique course identifier (integer)
- `subject`: enum `MATHEMATICS`, `ENGLISH`, `SCIENCE`, `HISTORY`, etc.
- `yearFrom`, `yearTo`: year range (inclusive); e.g., years 9–11 for GCSE
- `title`: course name
- `pricePence`: price in pence (minor units); divide by 100 for display (e.g., 19900 = £199.00)

**Error codes:** None (always succeeds).

---

### GET /courses/:id

Fetch a single course by ID.

**Auth:** Public

**Idempotent:** N/A (GET)

**Path parameters:**

| Param | Type | Rules |
|-------|------|-------|
| id    | int  | Positive integer |

**Response `200`:**
```json
{
  "id": 1,
  "subject": "MATHEMATICS",
  "yearFrom": 9,
  "yearTo": 11,
  "title": "GCSE Mathematics",
  "pricePence": 19900
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 404  | `COURSE_NOT_FOUND` | Course ID does not exist. |

---

## Purchases

All purchase endpoints require PARENT role and a valid bearer token.

### POST /purchases

Create a purchase for a student (parent action). Generates an invitation link and starts the student onboarding flow.

**Auth:** Bearer JWT (PARENT only)

**Idempotent:** Yes — requires `Idempotency-Key` header.

**Request headers:**

| Header | Required | Notes |
|--------|----------|-------|
| `Idempotency-Key` | Yes | UUID or arbitrary string; must be unique per request body. Same key + same body = cached response. |

**Request body:**

| Field | Type | Rules |
|-------|------|-------|
| courseId | int | Positive integer; course must exist |
| studentEmail | string | Valid email, max 255 chars; trimmed & lowercased |

**Example:**
```json
{
  "courseId": 1,
  "studentEmail": "student@example.com"
}
```

**Response `201`:**
```json
{
  "id": 42,
  "courseId": 1,
  "status": "PENDING",
  "amountPence": 19900,
  "createdAt": "2026-05-13T10:30:00Z",
  "invitation": {
    "id": 101,
    "studentEmail": "student@example.com",
    "status": "PENDING",
    "expiresAt": "2026-05-20T10:30:00Z",
    "url": "http://localhost:3000/invite?token=abc123xyz789..."
  }
}
```

Fields:
- `status`: enum `PENDING`, `COMPLETED`; invitation status drives purchase completion
- `amountPence`: total cost in minor units
- `createdAt`: ISO-8601 UTC timestamp
- `invitation.url`: full redemption URL with embedded token (short-lived, one-time use)

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 400  | `VALIDATION_FAILED` | courseId not an int, studentEmail invalid, etc. |
| 400  | `IDEMPOTENCY_KEY_REQUIRED` | Idempotency-Key header missing. |
| 401  | `AUTH_MISSING_TOKEN` | Authorization header missing. |
| 401  | `AUTH_INVALID_TOKEN` | Token invalid or expired. |
| 403  | `AUTH_FORBIDDEN_ROLE` | Authenticated user is not a PARENT. |
| 404  | `COURSE_NOT_FOUND` | Course ID does not exist. |
| 409  | `PURCHASE_ALREADY_EXISTS_FOR_STUDENT` | The calling parent has already completed a purchase for this course with this student email. No purchase or invitation is created. Scoped to the calling parent — cross-parent duplicates are still caught at invitation redemption. |
| 409  | `IDEMPOTENCY_BODY_MISMATCH` | Same Idempotency-Key was used with a different request body. Pick a new key and do not retry. |
| 409  | `IDEMPOTENCY_KEY_REUSED` | Same Idempotency-Key + body is still being processed. Retry after short backoff. |

---

### GET /me/purchases

List all purchases by the authenticated parent (newest first).

**Auth:** Bearer JWT (PARENT only)

**Idempotent:** N/A (GET)

**Response `200`:**
```json
[
  {
    "id": 42,
    "courseId": 1,
    "status": "PENDING",
    "amountPence": 19900,
    "createdAt": "2026-05-13T10:30:00Z",
    "invitation": {
      "id": 101,
      "studentEmail": "student@example.com",
      "status": "PENDING",
      "expiresAt": "2026-05-20T10:30:00Z",
      "url": "http://localhost:3000/invite?token=abc123xyz789..."
    }
  }
]
```

On the list endpoint, `invitation.url` is the redemption URL stored at purchase time (plaintext token is not regenerated).

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 401  | `AUTH_MISSING_TOKEN` | Authorization header missing. |
| 401  | `AUTH_INVALID_TOKEN` | Token invalid or expired. |
| 403  | `AUTH_FORBIDDEN_ROLE` | Authenticated user is not a PARENT. |

---

## LMS Access

All LMS endpoints require STUDENT role and a valid bearer token.

### GET /me/courses

Fetch the authenticated student's enrolled courses.

**Auth:** Bearer JWT (STUDENT only)

**Idempotent:** N/A (GET)

**Response `200`:**
```json
[
  {
    "id": 1,
    "subject": "MATHEMATICS",
    "yearFrom": 9,
    "yearTo": 11,
    "title": "GCSE Mathematics",
    "pricePence": 19900
  }
]
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 401  | `AUTH_MISSING_TOKEN` | Authorization header missing. |
| 401  | `AUTH_INVALID_TOKEN` | Token invalid or expired. |
| 403  | `AUTH_FORBIDDEN_ROLE` | Authenticated user is not a STUDENT. |

---

### GET /courses/:id/lessons

List all lessons in a course (student must be enrolled).

**Auth:** Bearer JWT (STUDENT only)

**Idempotent:** N/A (GET)

**Path parameters:**

| Param | Type | Rules |
|-------|------|-------|
| id    | int  | Positive integer (course ID) |

**Response `200`:**
```json
[
  {
    "id": 1,
    "courseId": 1,
    "title": "Introduction to Algebra",
    "orderIndex": 1,
    "createdAt": "2026-05-13T10:00:00Z"
  }
]
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 401  | `AUTH_MISSING_TOKEN` | Authorization header missing. |
| 401  | `AUTH_INVALID_TOKEN` | Token invalid or expired. |
| 403  | `AUTH_FORBIDDEN_ROLE` | Authenticated user is not a STUDENT. |
| 403  | `NOT_ENROLLED` | Student is not enrolled in this course. |
| 404  | `COURSE_NOT_FOUND` | Course ID does not exist. |

---

### GET /lessons/:id

Fetch a single lesson (student must be enrolled in the lesson's course).

**Auth:** Bearer JWT (STUDENT only)

**Idempotent:** N/A (GET)

**Path parameters:**

| Param | Type | Rules |
|-------|------|-------|
| id    | int  | Positive integer (lesson ID) |

**Response `200`:**
```json
{
  "id": 1,
  "courseId": 1,
  "title": "Introduction to Algebra",
  "body": "<p>Algebra is the branch of mathematics...</p>",
  "orderIndex": 1,
  "createdAt": "2026-05-13T10:00:00Z"
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 401  | `AUTH_MISSING_TOKEN` | Authorization header missing. |
| 401  | `AUTH_INVALID_TOKEN` | Token invalid or expired. |
| 403  | `AUTH_FORBIDDEN_ROLE` | Authenticated user is not a STUDENT. |
| 403  | `NOT_ENROLLED` | Student is not enrolled in the lesson's course (oracle-resistant: same response as lesson not found). |

---

## Invitations

All invitation endpoints are public (unauthenticated). Token-based redemption prevents enumeration.

### GET /invitations/:token/meta

Preview invitation details before redemption (course title, parent email, expiry, etc.).

**Auth:** Public

**Idempotent:** N/A (GET)

**Path parameters:**

| Param | Type | Rules |
|-------|------|-------|
| token | string | Invitation token (from URL); min 1 char |

**Response `200`:**
```json
{
  "courseTitle": "GCSE Mathematics",
  "parentEmail": "parent@example.com",
  "studentEmail": "student@example.com",
  "expiresAt": "2026-05-20T10:30:00Z",
  "status": "ISSUED"
}
```

**Error codes:**

All four invitation failure paths return **HTTP 410 (Gone)** with the same generic message to provide oracle-resistance (client cannot infer whether a token existed or is expired/redeemed):

| HTTP | Code | When |
|------|------|------|
| 410  | `INVITATION_NOT_FOUND` | Token not found in database. |
| 410  | `INVITATION_EXPIRED` | Token exists but `expiresAt` is past current time. |
| 410  | `INVITATION_ALREADY_REDEEMED` | Token was already redeemed. |
| 410  | `INVITATION_EMAIL_CONFLICT` | Student email already has a user account (oracle-resistance). |

---

### POST /invitations/redeem

Redeem an invitation and create the student account atomically. Returns an access token so the student lands in the LMS without a separate login.

**Auth:** Public

**Idempotent:** No

**Request body:**

| Field | Type | Rules |
|-------|------|-------|
| token | string | Invitation token; min 1 char |
| firstName | string | 1–80 chars |
| lastName | string | 1–80 chars |
| dateOfBirth | string | YYYY-MM-DD format (e.g., "2010-05-15") |
| password | string | 8+ chars; at least one uppercase, one lowercase, one digit |

**Example:**
```json
{
  "token": "abc123xyz789...",
  "firstName": "Bob",
  "lastName": "Jones",
  "dateOfBirth": "2010-05-15",
  "password": "StudentPass123"
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

The access token authenticates the new student immediately; they can call `GET /auth/me` or access the LMS without a separate login step.

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 400  | `VALIDATION_FAILED` | firstName/lastName too long, dateOfBirth not YYYY-MM-DD, password weak, etc. (see `details.fields`) |
| 410  | `INVITATION_NOT_FOUND` | Token not in database. |
| 410  | `INVITATION_EXPIRED` | Token past expiry. |
| 410  | `INVITATION_ALREADY_REDEEMED` | Token already redeemed. |
| 410  | `INVITATION_EMAIL_CONFLICT` | Student email already has a user account. |

---

## Health

### GET /health/live

Liveness probe. Returns immediately; no I/O. Used by load balancers / orchestrators to check if the process is up.

**Auth:** Public

**Idempotent:** N/A (GET)

**Response `200`:**
```json
{
  "status": "ok"
}
```

**Error codes:** None (always succeeds if process is running).

---

### GET /health/ready

Readiness probe. Pings Postgres and Redis to confirm the backend is ready to serve traffic.

**Auth:** Public

**Idempotent:** N/A (GET)

**Response `200`:**
```json
{
  "status": "ok",
  "info": {
    "postgres": {
      "status": "up"
    },
    "redis": {
      "status": "up"
    }
  }
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 503  | (Nest `@nestjs/terminus` standard) | Postgres or Redis is unreachable or timed out. |

---

## Error Reference

All error responses follow the canonical JSON shape:
```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable description",
  "requestId": "unique-uuid",
  "details": {}
}
```

| HTTP | Code | Meaning | Notes |
|------|------|---------|-------|
| 400 | `VALIDATION_FAILED` | Request body or query failed schema validation. | `details.fields`: per-field reason map. |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | POST to an idempotent route without `Idempotency-Key` header. | Pick a UUID and retry. |
| 401 | `AUTH_MISSING_TOKEN` | No `Authorization` header or malformed value. | Add `Authorization: Bearer <token>`. |
| 401 | `AUTH_INVALID_TOKEN` | Token signature invalid, unknown `alg`, or `kid` not found. | Re-authenticate; get a new token. |
| 401 | `AUTH_TOKEN_EXPIRED` | Token `exp` claim is past current time. | Token lifetime is per JWT_EXPIRES_IN env var (default 1 hour). |
| 401 | `AUTH_INVALID_CREDENTIALS` | Login email not found or password mismatch. | Verify email and password. |
| 403 | `AUTH_FORBIDDEN_ROLE` | Authenticated user lacks required role. | E.g., STUDENT calling `POST /purchases` (PARENT only). |
| 404 | `COURSE_NOT_FOUND` | Course ID does not exist. | Verify course ID exists via `GET /courses`. |
| 409 | `USER_EMAIL_TAKEN` | Signup email already registered. | Use a different email or login instead. |
| 409 | `IDEMPOTENCY_BODY_MISMATCH` | Same Idempotency-Key used with different request body. | **Do not retry.** Pick a new key. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key + body currently being processed. | Retry after 1–2 second backoff. |
| 409 | `PURCHASE_ALREADY_EXISTS_FOR_STUDENT` | Calling parent already completed a purchase for this course + student email. | Scoped to the calling parent. Cross-parent duplicates surface at invitation redemption. |
| 410 | `INVITATION_NOT_FOUND` | Invitation token not in database. | Oracle-resistant: same message for all invitation errors. |
| 410 | `INVITATION_EXPIRED` | Invitation past expiry timestamp. | Oracle-resistant: same message for all invitation errors. |
| 410 | `INVITATION_ALREADY_REDEEMED` | Invitation was already redeemed. | Oracle-resistant: same message for all invitation errors. |
| 410 | `INVITATION_EMAIL_CONFLICT` | Invitation's student email already has a user account. | Oracle-resistant: same message for all invitation errors. |

---

## Implementation Notes

- **JWT Expiry:** `expiresIn` is always seconds (e.g., 3600 = 1 hour).
- **Timestamps:** All `*At` fields are ISO-8601 UTC strings (no `Date` type crosses the wire).
- **Money:** All `*Pence` fields are integers in pence (minor units); divide by 100 for display (e.g., 19900 = £199.00).
- **Email Normalization:** All email fields are trimmed and lowercased on input (by the validation pipe).
- **Password Policy:** Enforced by the backend (class-validator + regex); the frontend schema (`@mes/shared/schemas/`) must match.
- **Oracle-Resistance:** All four invitation redemption failure paths return HTTP 410 with the same message to prevent timing-based or message-based enumeration.
