/**
 * Projection of a `lessons` row returned by `GET /courses/:id/lessons`.
 *
 * `id` is a UUID string (lessons use UUID primary keys).
 * `courseId` references the parent course (FK).
 * `orderIndex` determines display order within a course (ascending).
 * `createdAt` is ISO-8601 UTC.
 */
export interface ILessonResponse {
    id: string;
    courseId: number;
    title: string;
    body: string;
    orderIndex: number;
    createdAt: string;
}
