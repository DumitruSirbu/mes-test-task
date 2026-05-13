import { DomainError } from './DomainError';

/**
 * 404 — `GET /lessons/:id` found no row matching the given UUID.
 */
export class LessonNotFoundError extends DomainError {
    public constructor(details?: Record<string, unknown>) {
        super({
            httpStatus: 404,
            code: 'LESSON_NOT_FOUND',
            message: 'Lesson not found.',
            details,
        });
    }
}
