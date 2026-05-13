import { useEffect, useState, type ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import type { ICourseResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { formatPricePence } from '../util/formatPrice';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';

interface IProps {
    courseId: string;
}

export const CourseDetailPage = ({ courseId }: IProps): ReactElement => {
    const [course, setCourse] = useState<ICourseResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const auth = useAuth();

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
            <a href="#/courses">← Back to catalog</a>
            <h1>{course.title}</h1>
            <p>{course.subject} · Year {course.yearFrom}{course.yearTo !== course.yearFrom ? `–${course.yearTo}` : ''}</p>
            <p className="price">{formatPricePence(course.pricePence)}</p>
            {canBuy ? (
                <button type="button" onClick={onBuy}>Buy access for a student</button>
            ) : (
                <p>Only parents can purchase access.</p>
            )}
        </div>
    );
};
