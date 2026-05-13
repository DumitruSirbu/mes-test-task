import { DomainError } from './DomainError';
import { HTTP_STATUS_CONFLICT } from '../const/CommonConsts';

/**
 * 409 — a unique-constraint violation (PG error 23505) occurred on the
 * `IDX_enrolments_student_course_unique` index, meaning this student is
 * already enrolled in the requested course.
 */
export class EnrolmentAlreadyExistsError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_CONFLICT,
            code: 'ENROLMENT_ALREADY_EXISTS',
            message: 'Student is already enrolled in this course.',
            cause,
        });
    }
}
