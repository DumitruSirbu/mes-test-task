import { DomainError } from './DomainError';

/**
 * 404 — `GET /courses/:id` (or any service path that resolves a course by id) found no row.
 *
 * Returned to the parent during the checkout flow when the requested course no longer exists.
 */
export class CourseNotFoundError extends DomainError {
    public constructor(details?: Record<string, unknown>, cause?: unknown) {
        super({
            httpStatus: 404,
            code: 'COURSE_NOT_FOUND',
            message: 'Course not found.',
            details,
            cause,
        });
    }
}
