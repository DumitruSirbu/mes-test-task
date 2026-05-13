import { DomainError } from './DomainError';

/**
 * 403 — the authenticated student attempted to access a course or lesson they are not
 * enrolled in. Raised by `LessonsService` on the enrolment guard path.
 *
 * Returns 403 (not 404) so a malicious caller cannot enumerate course IDs by probing
 * for 404 vs 403 differences. The student can only prove whether they are enrolled, not
 * whether the resource exists at all.
 */
export class NotEnrolledError extends DomainError {
    public constructor(details?: Record<string, unknown>) {
        super({
            httpStatus: 403,
            code: 'NOT_ENROLLED',
            message: 'You are not enrolled in this course.',
            details,
        });
    }
}
