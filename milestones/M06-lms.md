# M06 — LMS Access

> **Status:** pending · **Owner:** mes-orchestrator → mes-shared-maintainer → mes-backend-nestjs → mes-frontend-react → mes-qa-engineer → reviewers → mes-scribe

## Goal

Authenticated students see their enrolled courses, can drill into a course's lesson list, and open a lesson.

## Depends on

M05 (students exist + enrolments exist).

## Deliverables

### Shared package

- `packages/shared/src/types/ILessonResponse.ts`, `ICourseWithLessonsResponse.ts`.

### Backend

- `lessons/` — `LessonEntity`, `LessonsRepository`, `LessonsService`.
- `GET /me/courses` — guarded `@Roles(UserRoleEnum.STUDENT)`. Returns the student's enrolled courses.
- `GET /courses/:id/lessons` — student-only; rejects if the student is not enrolled in that course.
- `GET /lessons/:id` — student-only; rejects if the student is not enrolled in the lesson's course.
- Seed 3-5 lessons per course in a migration or seed script.

### Migrations

- `<ts>-CreateLessonsTable.ts` — `lesson_id` PK, FK to `courses`, `title`, `body text`, `order_index`, `created_at`.

### Frontend (`apps/web/`)

- `/lms` — dashboard listing enrolled courses.
- `/lms/courses/:id` — lessons list.
- `/lms/lessons/:id` — lesson detail.
- All routes guarded `STUDENT` only.

## Agent dispatch plan

| Wave | Agents (dispatched in one message) | Runs after |
|------|-------------------------------------|------------|
| 1 | `mes-scribe` — log start time in work-log | — |
| 2 | `mes-shared-maintainer` — `ILessonResponse`, `ICourseWithLessonsResponse` | Wave 1 |
| 3 | `mes-backend-nestjs` **∥** `mes-frontend-react` | Wave 2 |
| 4 | `mes-qa-engineer` — enrolment gate, cross-tenant isolation, lesson access | Wave 3 |
| 5 | `mes-review-security` **∥** `mes-review-logic` **∥** `mes-review-clean-code` | Wave 4 |
| 6 | `mes-scribe` — `docs/features/lms-access.md`, close work-log row | Wave 5 |

**Wave 3 detail (parallel):**
- `mes-backend-nestjs`: `LessonEntity`, `LessonsRepository`, `LessonsService`, migration, `GET /me/courses`, `GET /courses/:id/lessons`, `GET /lessons/:id` with enrolment enforcement, seed 3–5 lessons per course.
- `mes-frontend-react`: `/lms` dashboard, `/lms/courses/:id` lesson list, `/lms/lessons/:id` detail — all `STUDENT`-only guards.

## Definition of Done

- Student from M05 sees Maths Y7 on `/lms`, opens it, sees lessons, opens one.
- Cross-tenant test: another student (manually created) does NOT see this student's course.
- All reviewers report no blockers.

## Outcome

(filled by mes-scribe at close)
