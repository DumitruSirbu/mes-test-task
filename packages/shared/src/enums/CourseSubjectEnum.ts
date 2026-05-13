/**
 * Canonical course subject vocabulary shared between backend and frontend.
 *
 * Mirrors the PostgreSQL native enum `course_subject` (see data-model.md).
 * Seeded values per the M04 brief: Maths Y5–Y13, English Y5–Y13, Science Y5–Y11.
 */
export enum CourseSubjectEnum {
    MATHS = 'MATHS',
    ENGLISH = 'ENGLISH',
    SCIENCE = 'SCIENCE',
}
