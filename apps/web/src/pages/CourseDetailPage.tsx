import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PurchaseStatusEnum, UserRoleEnum } from '@mes/shared';
import type { ICourseResponse, IPurchaseResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { formatPricePence } from '../util/formatPrice';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';
import { CHECKOUT_FLASH_STORAGE_KEY, parseCheckoutFlash } from '../util/checkoutFlash';

interface IProps {
    courseId: string;
}

interface IStudentPurchaseGroup {
    studentEmail: string;
    courses: { courseId: number; title: string }[];
}

/**
 * Reads a one-shot checkout flash from sessionStorage, returning the studentEmail when
 * it targets `courseId`. Side-effects (removing the entry) live here so the caller can
 * keep it as a pure `useState` initializer — no setState-in-effect needed.
 *
 * Leaves flashes that target a different course intact so the intended page can still
 * consume them; discards malformed entries to keep storage clean.
 */
const consumeAlreadyEnrolledFlashFor = (courseId: string): string | null => {
    const raw = sessionStorage.getItem(CHECKOUT_FLASH_STORAGE_KEY);

    if (!raw) {
        return null;
    }

    const flash = parseCheckoutFlash(raw);

    if (flash === null) {
        sessionStorage.removeItem(CHECKOUT_FLASH_STORAGE_KEY);

        return null;
    }

    if (flash.courseId !== courseId) {
        return null;
    }

    sessionStorage.removeItem(CHECKOUT_FLASH_STORAGE_KEY);

    return flash.studentEmail;
};

export const CourseDetailPage = ({ courseId }: IProps): ReactElement => {
    const [course, setCourse] = useState<ICourseResponse | null>(null);
    const [purchases, setPurchases] = useState<IPurchaseResponse[]>([]);
    const [allCourses, setAllCourses] = useState<ICourseResponse[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [alreadyEnrolledEmail] = useState<string | null>(() => consumeAlreadyEnrolledFlashFor(courseId));
    const auth = useAuth();

    const isParent = auth?.role === UserRoleEnum.PARENT;

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

    useEffect(() => {
        if (!isParent || !auth) {
            return;
        }

        let cancelled = false;

        const loadParentContext = async (): Promise<void> => {
            try {
                const [purchaseList, courseList] = await Promise.all([
                    apiRequest<IPurchaseResponse[]>('/me/purchases', { token: auth.accessToken }),
                    apiRequest<ICourseResponse[]>('/courses'),
                ]);

                if (!cancelled) {
                    setPurchases(purchaseList);
                    setAllCourses(courseList);
                }
            } catch {
                // Students panel is supplementary — silently skip on error.
            }
        };

        void loadParentContext();

        return () => {
            cancelled = true;
        };
    }, [auth, isParent]);

    const studentGroups = useMemo<IStudentPurchaseGroup[]>(() => {
        if (!isParent || purchases.length === 0) {
            return [];
        }

        const courseTitleById = new Map(allCourses.map((entry) => [entry.id, entry.title]));
        const grouped = new Map<string, IStudentPurchaseGroup>();

        for (const purchase of purchases) {
            if (purchase.status !== PurchaseStatusEnum.COMPLETED) {
                continue;
            }

            const email = purchase.invitation.studentEmail;
            const title = courseTitleById.get(purchase.courseId) ?? `Course #${purchase.courseId}`;
            const existing = grouped.get(email);

            if (existing) {
                if (!existing.courses.some((entry) => entry.courseId === purchase.courseId)) {
                    existing.courses.push({ courseId: purchase.courseId, title });
                }
            } else {
                grouped.set(email, {
                    studentEmail: email,
                    courses: [{ courseId: purchase.courseId, title }],
                });
            }
        }

        return Array.from(grouped.values());
    }, [allCourses, isParent, purchases]);

    if (error) {
        return <p role="alert" className="error">{error}</p>;
    }

    if (!course) {
        return <p>Loading…</p>;
    }

    const onBuy = (): void => {
        if (!auth) {
            navigate('/login');

            return;
        }

        if (auth.role !== UserRoleEnum.PARENT) {
            // STUDENT / ADMIN cannot purchase; the backend would 403 anyway.
            return;
        }

        navigate(`/checkout/${course.id}`);
    };

    const canBuy = !auth || auth.role === UserRoleEnum.PARENT;

    return (
        <div className="page">
            <div className="page-actions">
                <button type="button" className="back-button" onClick={() => navigate('/courses')}>← Back to catalog</button>
            </div>
            {alreadyEnrolledEmail ? (
                <p role="status" className="info">{alreadyEnrolledEmail} is already enrolled in this course.</p>
            ) : null}
            <h1>{course.title}</h1>
            <p>{course.subject} · Year {course.yearFrom}{course.yearTo !== course.yearFrom ? `–${course.yearTo}` : ''}</p>
            <p className="price">{formatPricePence(course.pricePence)}</p>
            {canBuy ? (
                <button type="button" onClick={onBuy}>Buy access for a student</button>
            ) : (
                <p>Only parents can purchase access.</p>
            )}
            {isParent ? (
                <section className="students-panel">
                    <h2>My students</h2>
                    {studentGroups.length === 0 ? (
                        <p>No purchases yet. Buy access for a student to see them listed here.</p>
                    ) : (
                        <ul className="student-list">
                            {studentGroups.map((group) => (
                                <li key={group.studentEmail} className="student-item">
                                    <strong>{group.studentEmail}</strong>
                                    <ul>
                                        {group.courses.map((entry) => (
                                            <li key={entry.courseId}>{entry.title}</li>
                                        ))}
                                    </ul>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            ) : null}
        </div>
    );
};
