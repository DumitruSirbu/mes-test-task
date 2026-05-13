import { DomainError } from './DomainError';
import { HTTP_STATUS_CONFLICT } from '../const/CommonConsts';

/**
 * 409 — the calling parent has already completed a purchase for the same course AND
 * the same student email. We reject before opening the transaction so the parent does
 * not pay twice for an invitation that would land on a student who already holds an
 * active enrolment via this parent's earlier purchase.
 *
 * Scoped to the calling parent on purpose: a cross-parent duplicate would leak the
 * existence of a registered student account / enrolment to a different parent. Cross-
 * parent duplicates are still caught at invitation redemption time by the unique
 * index on `enrolments(student_user_id, course_id)` per ADR 0006.
 */
export class DuplicatePurchaseForStudentError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_CONFLICT,
            code: 'PURCHASE_ALREADY_EXISTS_FOR_STUDENT',
            message: 'You have already purchased this course for this student.',
            cause,
        });
    }
}
