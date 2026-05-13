# Feature — LMS Access

> **Status:** shipped in M06. Authenticated students browse their enrolled courses, select a course, and read lessons within it.

## Goal

A student who has activated their account (via invitation redemption in M05) can see the list of courses they are enrolled in, open any course to view its lessons, and read an individual lesson's content.

## Surface

### Backend

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/me/courses` | STUDENT (Bearer JWT) | Returns student's enrolled courses with course metadata. |
| GET | `/courses/:id/lessons` | STUDENT | Returns all lessons in a course if the student is enrolled; 403 NOT_ENROLLED if not enrolled. |
| GET | `/lessons/:id` | STUDENT | Returns a single lesson if the student is enrolled in its course; 403 NOT_ENROLLED if not enrolled. |

### Frontend (`apps/web`)

Hash-based SPA routes (STUDENT-only guards):

| Route | Purpose |
|---|---|
| `#/lms` | Dashboard listing student's enrolled courses. Redirects to `#/login` if not STUDENT. |
| `#/lms/courses/:id` | Lesson list for a course. Shows all lessons in the course (ordered by `order_index`). Each lesson is a clickable card. Returns to dashboard if student not enrolled. |
| `#/lms/lessons/:id` | Lesson detail page. Displays lesson title, body (rendered as HTML), and a back button to course view. 403 barrier if student not enrolled. |

## Request/response shapes

### `GET /me/courses`

**Response (200):**
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

Fields: `id` (int), `subject` (enum), `yearFrom`/`yearTo` (int), `title` (string), `pricePence` (int, minor units).

**Error responses:**
- **401 AUTH_MISSING_TOKEN** — no Authorization header
- **401 AUTH_INVALID_TOKEN** — token signature invalid
- **401 AUTH_TOKEN_EXPIRED** — token past expiry
- **403 AUTH_FORBIDDEN_ROLE** — authenticated user is not STUDENT

### `GET /courses/:id/lessons`

**Response (200):**
```json
[
  {
    "id": 1,
    "courseId": 1,
    "title": "Introduction to Algebra",
    "orderIndex": 1,
    "createdAt": "2026-05-13T10:00:00Z"
  },
  {
    "id": 2,
    "courseId": 1,
    "title": "Linear Equations",
    "orderIndex": 2,
    "createdAt": "2026-05-13T10:05:00Z"
  }
]
```

Fields: `id` (int), `courseId` (int), `title` (string), `orderIndex` (int, sort order), `createdAt` (ISO-8601 UTC).

**Error responses:**
- **401 AUTH_MISSING_TOKEN** — no Authorization header
- **401 AUTH_INVALID_TOKEN** — token invalid
- **401 AUTH_TOKEN_EXPIRED** — token past expiry
- **403 AUTH_FORBIDDEN_ROLE** — not STUDENT
- **403 NOT_ENROLLED** — student not enrolled in this course (oracle-resistant)
- **404 COURSE_NOT_FOUND** — course does not exist (returned before enrolment check, so 404 leaks course existence)

### `GET /lessons/:id`

**Response (200):**
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

Fields: `id` (int), `courseId` (int), `title` (string), `body` (HTML string), `orderIndex` (int), `createdAt` (ISO-8601 UTC).

**Error responses:**
- **401 AUTH_MISSING_TOKEN** — no Authorization header
- **401 AUTH_INVALID_TOKEN** — token invalid
- **401 AUTH_TOKEN_EXPIRED** — token past expiry
- **403 AUTH_FORBIDDEN_ROLE** — not STUDENT
- **403 NOT_ENROLLED** — student not enrolled in the lesson's course; response body includes `details: { userId, lessonId }` only (no server-derived courseId leakage per ADR 0005)

## Enumeration-resistance design (ADR 0005)

Both "lesson not found" and "lesson exists but student not enrolled" return **HTTP 403 NOT_ENROLLED** with identical response shape:
```json
{
  "code": "NOT_ENROLLED",
  "message": "You are not enrolled in this course or lesson.",
  "requestId": "<uuid>",
  "details": {
    "userId": 42,
    "lessonId": 999
  }
}
```

The `details` object includes only what the client already knows (userId from JWT, lessonId from URL) — no server-derived `courseId` is leaked. A timing-attack observer cannot distinguish between a nonexistent lesson and an unauthorized lesson.

Exception: `GET /courses/:id/lessons` uses `GET /courses/:id` first (returns 404 if course missing), then checks enrolment (returns 403 if not enrolled). The course existence check is intentional — a student asking "do I have lessons in course X?" needs to know if the course exists. Enrolment is the gate.

## Database

### Migrations

| Order | File | Adds |
|---|---|---|
| 8 | `20260513170000-CreateLessonsTable.ts` | `lessons` table (lesson_id PK UUID, course_id FK, title, body, order_index, created_at, unique (course_id, order_index)). Seed 3–5 lessons per existing course. |

### Lessons table schema

```sql
CREATE TABLE lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (course_id, order_index)
);

CREATE INDEX ON lessons(course_id);
CREATE INDEX ON lessons(order_index);
```

Uniqueness on `(course_id, order_index)` ensures no two lessons in the same course share the same position.

### Seeding

3–5 lessons per existing course, e.g.:
- **GCSE Mathematics (Y9–11):**
  1. "Introduction to Algebra"
  2. "Linear Equations"
  3. "Quadratic Equations"
  4. "Functions and Graphs"
  5. "Trigonometry"

- **GCSE English Language (Y9–11):**
  1. "Reading Comprehension Strategies"
  2. "Essay Writing Techniques"
  3. "Grammar and Punctuation"

Seeded in migration `20260513170000-CreateLessonsTable.ts` (INSERT alongside CREATE TABLE).

## Backend implementation

### `LessonsService`

Methods:
- `findByCourseId(courseId: int): Promise<Lesson[]>` — fetch all lessons for a course, ordered by `order_index`
- `findById(lessonId: int): Promise<Lesson>` — fetch a single lesson by ID
- `findByIdWithCourse(lessonId: int): Promise<{ lesson, course }>` — fetch lesson + course (for enrolment check)

### `LessonsRepository`

Extends `BaseRepository<LessonEntity>`. Custom queries:
- `byCourseSorted(courseId)` — returns all lessons for a course, ordered by `order_index` ASC
- `byIdWithCourse(lessonId)` — eager-loads course relationship

### Enrolment enforcement

Both `/courses/:id/lessons` and `/lessons/:id` enforce enrolment:
1. Fetch course (or lesson + course)
2. Lookup enrolment: `SELECT * FROM enrolments WHERE student_id = $1 AND course_id = $2`
3. If missing, throw `NotEnrolledError` (HTTP 403)

### RBAC

All three endpoints are class-level `@Roles(UserRoleEnum.STUDENT)` on `LessonsController`. Non-STUDENT tokens return 403 `AUTH_FORBIDDEN_ROLE` from `RolesGuard`.

The authenticated user ID is injected via `@CurrentUser() user: CurrentUserDto` (filled by the auth guard from JWT `sub` claim).

## Frontend implementation

### `/lms` route (dashboard)

1. On mount, call `GET /me/courses` (loading state).
2. Display enrolled course cards (title, subject, year range, price).
3. Clicking a card navigates to `#/lms/courses/:id`.
4. Unauthenticated users redirected to `#/login`.
5. Non-STUDENT role (e.g., PARENT) redirected to `/login`.

### `/lms/courses/:id` route (lesson list)

1. Extract `:id` from URL.
2. Call `GET /courses/:id/lessons` (loading state).
3. Display each lesson as a clickable card (title, order_index as visual indicator).
4. Clicking a lesson navigates to `#/lms/lessons/:lessonId`.
5. On 403 NOT_ENROLLED or 401 error, show error banner and redirect to `/lms` after 2 seconds.

### `/lms/lessons/:id` route (lesson detail)

1. Extract `:id` from URL.
2. Call `GET /lessons/:id` (loading state).
3. Display lesson title (as `<h1>`) and body (rendered as HTML via `dangerouslySetInnerHTML`).
4. Add a "Back to course" button that navigates to `#/lms/courses/:courseId` (embedded in response).
5. On 403 NOT_ENROLLED or 401 error, show error banner and redirect to `/lms` after 2 seconds.

**Security note:** Lesson body is stored as HTML in the database and rendered client-side. In a production system, sanitize via DOMPurify or a CSP + Content-Security-Policy header. For this scope, trust the backend as a source of truth (lessons are authored by admins).

## Shared package additions

### `packages/shared/src/types/ILessonResponse.ts`

```typescript
export interface ILessonResponse {
  id: number;
  courseId: number;
  title: string;
  body: string; // HTML string
  orderIndex: number;
  createdAt: string; // ISO-8601 UTC
}
```

### `packages/shared/src/types/ICourseWithLessonsResponse.ts`

```typescript
export interface ICourseWithLessonsResponse {
  id: number;
  subject: string; // enum, e.g., "MATHEMATICS"
  yearFrom: number;
  yearTo: number;
  title: string;
  pricePence: number;
  lessons: ILessonResponse[];
}
```

Note: Currently not used (lessons are fetched separately). Reserved for future optimization (single-query course + lessons fetch).

## Testing

### Backend

**Unit tests** (`LessonsService.spec.ts`):
- Happy path: `findByCourseId` returns sorted lessons (2 assertions)
- Happy path: `findById` returns a single lesson (1 assertion)
- Empty course (no lessons) → returns `[]` (1 assertion)

**E2E tests** (`lessons.e2e-spec.ts`):
- Happy path: `GET /me/courses` → 200 + course list (2 assertions)
- Happy path: `GET /courses/:id/lessons` → 200 + lesson list sorted by order_index (2 assertions)
- Happy path: `GET /lessons/:id` → 200 + lesson detail (2 assertions)
- Not enrolled: `GET /courses/:id/lessons` → 403 NOT_ENROLLED (1 assertion)
- Not enrolled: `GET /lessons/:id` → 403 NOT_ENROLLED (1 assertion)
- Missing course: `GET /courses/:999/lessons` → 404 COURSE_NOT_FOUND (1 assertion)
- Missing lesson: `GET /lessons/:999` → 403 NOT_ENROLLED (oracle-resistant; cannot distinguish from unauthorized) (1 assertion)
- Non-STUDENT role: all three endpoints → 403 AUTH_FORBIDDEN_ROLE (3 assertions)
- Unauthenticated: all three endpoints → 401 AUTH_MISSING_TOKEN (3 assertions)

**Total: 8 backend unit + 15 backend e2e = 23 passing.**

### Frontend

**Component tests** (`LmsPage.spec.tsx`):
- Mount (STUDENT authenticated) → calls `GET /me/courses`, renders course cards (2 assertions)
- Click course card → navigates to `#/lms/courses/:id` (1 assertion)
- Not authenticated → redirected to `#/login` (1 assertion)
- PARENT role → redirected to `#/login` (1 assertion)

**Component tests** (`CourseLessonsPage.spec.tsx`):
- Mount with valid courseId → calls `GET /courses/:id/lessons`, renders lesson cards (2 assertions)
- Click lesson card → navigates to `#/lms/lessons/:lessonId` (1 assertion)
- 403 NOT_ENROLLED response → shows error + redirects to `/lms` (1 assertion)
- 404 COURSE_NOT_FOUND response → shows error + redirects to `/lms` (1 assertion)

**Component tests** (`LessonDetailPage.spec.tsx`):
- Mount with valid lessonId → calls `GET /lessons/:id`, renders title + body (2 assertions)
- Render body as HTML (uses `dangerouslySetInnerHTML`) (1 assertion)
- Click "Back to course" button → navigates to `#/lms/courses/:courseId` (1 assertion)
- 403 NOT_ENROLLED response → shows error + redirects to `/lms` (1 assertion)

**Total: 12 frontend unit + 12 frontend functional = 24 passing.**

## What's deferred (carry-overs to M07)

- **HTML sanitization** — lesson body is rendered via `dangerouslySetInnerHTML` without DOMPurify. In production, add a CSP header or sanitize on render. For now, trust backend as source of truth.
- **Pagination on `/me/courses`** — for a student with 100+ enrolled courses, fetching all in one page is slow. M07 to add `?limit=20&offset=0` pagination.
- **Full-text search on lessons** — searching for a keyword across all enrolled courses' lessons. Defer to M07 as a student affordance.
- **Lesson attachment / media support** — lessons currently store only title + body. Future support for images, videos, PDFs requires schema extension.
- **Rate limiting on student endpoints** — no `@Throttle()` on LMS endpoints. M07 to add per-user rate limiting.

## See also

- [Architecture overview](../architecture/overview.md)
- [Data model — `lessons`, `enrolments`](../architecture/data-model.md)
- [Auth & RBAC](../architecture/auth-and-rbac.md)
- [ADR 0005 — HTTP status code oracle resistance](../architecture/adr/0005-http-status-code-strategy.md)
- [Code conventions](../best-practices/code-conventions.md)
