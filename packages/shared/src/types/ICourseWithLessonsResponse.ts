import type { ICourseResponse } from './ICourseResponse.js';
import type { ILessonResponse } from './ILessonResponse.js';

/**
 * Extends `ICourseResponse` with embedded lessons array.
 * Returned by `GET /courses/:id` to populate the LMS dashboard with a course and its lessons.
 */
export interface ICourseWithLessonsResponse extends ICourseResponse {
    lessons: ILessonResponse[];
}
