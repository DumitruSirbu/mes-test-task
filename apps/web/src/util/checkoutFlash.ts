export const CHECKOUT_FLASH_STORAGE_KEY = 'mes.checkoutFlash.v1';

export const CHECKOUT_FLASH_KIND_ALREADY_ENROLLED = 'already-enrolled';

/**
 * Backend domain code returned with HTTP 409 when a parent tries to purchase a course
 * they have already purchased for the same student email.
 */
export const PURCHASE_ALREADY_EXISTS_FOR_STUDENT_CODE = 'PURCHASE_ALREADY_EXISTS_FOR_STUDENT';

export interface ICheckoutFlash {
    kind: typeof CHECKOUT_FLASH_KIND_ALREADY_ENROLLED;
    studentEmail: string;
    courseId: string;
}

/**
 * Best-effort runtime validation of an opaque sessionStorage payload. Returns null
 * for anything that does not match the strict ICheckoutFlash shape — JSON-parse
 * failures, missing fields, wrong field types, or an unrecognised `kind` value.
 *
 * Storage is a trust boundary (another tab, an XSS payload, or a stale entry could
 * plant any shape) so callers must never `as`-cast the parsed value.
 */
export const parseCheckoutFlash = (raw: string): ICheckoutFlash | null => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return null;
    }

    const candidate = parsed as Record<string, unknown>;

    if (candidate.kind !== CHECKOUT_FLASH_KIND_ALREADY_ENROLLED) {
        return null;
    }

    if (typeof candidate.studentEmail !== 'string' || typeof candidate.courseId !== 'string') {
        return null;
    }

    return {
        kind: CHECKOUT_FLASH_KIND_ALREADY_ENROLLED,
        studentEmail: candidate.studentEmail,
        courseId: candidate.courseId,
    };
};
