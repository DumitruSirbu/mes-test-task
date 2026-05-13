import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { UserRoleEnum, createPurchaseSchema } from '@mes/shared';
import type { ICourseResponse, IPurchaseResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';
import { generateUuid } from '../util/uuid';
import { formatPricePence } from '../util/formatPrice';
import {
    CHECKOUT_FLASH_KIND_ALREADY_ENROLLED,
    CHECKOUT_FLASH_STORAGE_KEY,
    PURCHASE_ALREADY_EXISTS_FOR_STUDENT_CODE,
    type ICheckoutFlash,
} from '../util/checkoutFlash';

interface IProps {
    courseId: string;
}

const LAST_PURCHASE_STORAGE_KEY = 'mes.lastPurchase.v1';

/**
 * Checkout form for a single course.
 *
 * Per ADR 0006:
 *   - `Idempotency-Key` is generated ONCE on mount; reloading the page produces a new key
 *     and lets the parent retry; a repeated form submit reuses the same key for a true
 *     idempotent replay.
 *   - The submit button is disabled while in flight to prevent double-click.
 *   - No retry on failure — the parent sees the error and can try again, picking a fresh key.
 */
export const CheckoutPage = ({ courseId }: IProps): ReactElement => {
    const auth = useAuth();
    const [course, setCourse] = useState<ICourseResponse | null>(null);
    const [studentEmail, setStudentEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Generate the idempotency key once per mount.
    const idempotencyKey = useMemo(() => generateUuid(), []);

    useEffect(() => {
        if (!auth || auth.role !== UserRoleEnum.PARENT) {
            navigate('/login');
        }
    }, [auth]);

    useEffect(() => {
        let cancelled = false;

        const load = async (): Promise<void> => {
            try {
                const detail = await apiRequest<ICourseResponse>(`/courses/${encodeURIComponent(courseId)}`);

                if (!cancelled) {
                    setCourse(detail);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : 'Failed to load course.');
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [courseId]);

    const onSubmit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setError(null);

        if (!auth) {
            navigate('/login');

            return;
        }

        const numericCourseId = Number(courseId);
        const parsed = createPurchaseSchema.safeParse({ courseId: numericCourseId, studentEmail });

        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Please enter a valid email.');

            return;
        }

        setSubmitting(true);

        try {
            const purchase = await apiRequest<IPurchaseResponse>('/purchases', {
                method: 'POST',
                body: parsed.data,
                token: auth.accessToken,
                headers: { 'Idempotency-Key': idempotencyKey },
            });

            sessionStorage.setItem(LAST_PURCHASE_STORAGE_KEY, JSON.stringify(purchase));
            navigate('/checkout/success');
        } catch (err) {
            if (err instanceof ApiError && err.status === 409 && err.code === PURCHASE_ALREADY_EXISTS_FOR_STUDENT_CODE) {
                const flash: ICheckoutFlash = {
                    kind: CHECKOUT_FLASH_KIND_ALREADY_ENROLLED,
                    studentEmail,
                    courseId,
                };

                sessionStorage.setItem(CHECKOUT_FLASH_STORAGE_KEY, JSON.stringify(flash));
                navigate(`/courses/${courseId}`);

                return;
            }

            setError(err instanceof ApiError ? err.message : 'Checkout failed.');
        } finally {
            setSubmitting(false);
        }
    };

    if (error && !course) {
        return <p role="alert" className="error">{error}</p>;
    }

    if (!course) {
        return <p>Loading…</p>;
    }

    return (
        <div className="page">
            <div className="page-actions">
                <button type="button" className="back-button" onClick={() => navigate(`/courses/${course.id}`)}>← Back</button>
            </div>
            <h1>Checkout — {course.title}</h1>
            <p>{course.subject} · Year {course.yearFrom}{course.yearTo !== course.yearFrom ? `–${course.yearTo}` : ''}</p>
            <p className="price">{formatPricePence(course.pricePence)}</p>
            <form onSubmit={(event) => void onSubmit(event)}>
                <label>
                    Student email (where the invitation link will be sent)
                    <input
                        type="email"
                        value={studentEmail}
                        onChange={(event) => setStudentEmail(event.target.value)}
                        required
                        autoComplete="email"
                    />
                </label>
                <button type="submit" disabled={submitting}>
                    {submitting ? 'Processing…' : `Buy for ${formatPricePence(course.pricePence)}`}
                </button>
            </form>
            {error ? <p role="alert" className="error">{error}</p> : null}
            <p className="hint">Idempotency-Key for this session: <code>{idempotencyKey}</code></p>
        </div>
    );
};
