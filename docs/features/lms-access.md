# Feature — LMS Access

> Status: stub. Filled in M06 by `mes-scribe`.

## Flow

1. Authenticated student opens `/lms` → `GET /me/courses` returns enrolled courses.
2. Click a course → `/lms/courses/:id` → `GET /courses/:id/lessons` returns lessons (enrolment check enforced).
3. Click a lesson → `/lms/lessons/:id` → `GET /lessons/:id` (enrolment check enforced).

## RBAC

- All LMS endpoints require `@Roles(STUDENT)`.
- Enrolment check: 403 `NOT_ENROLLED` if the student doesn't own an enrolment for that course.

## Cross-tenant safety

- Two students each enrolled in Maths Y7 see the same lessons but distinct progress (progress is out of scope for v1).
- A student attempting to read another student's course returns 403.
