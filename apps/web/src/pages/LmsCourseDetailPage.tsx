import { useEffect, useState, type ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import type { ICourseWithLessonsResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';

interface IProps {
    courseId: string;
}

export const LmsCourseDetailPage = ({ courseId }: IProps): ReactElement => {
    const auth = useAuth();
    const [courseWithLessons, setCourseWithLessons] = useState<ICourseWithLessonsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isForbiddenOrNotFound, setIsForbiddenOrNotFound] = useState(false);

    useEffect(() => {
        if (!auth || auth.role !== UserRoleEnum.STUDENT) {
            navigate('/login');
        }
    }, [auth]);

    useEffect(() => {
        if (!auth || auth.role !== UserRoleEnum.STUDENT) {
            return;
        }

        let cancelled = false;

        const load = async (): Promise<void> => {
            try {
                const detail = await apiRequest<ICourseWithLessonsResponse>(
                    `/courses/${encodeURIComponent(courseId)}/lessons`,
                    { token: auth.accessToken },
                );

                if (!cancelled) {
                    setCourseWithLessons(detail);
                }
            } catch (err) {
                if (!cancelled) {
                    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
                        setIsForbiddenOrNotFound(true);
                    } else {
                        setError(err instanceof ApiError ? err.message : 'Failed to load course.');
                    }
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [auth, courseId]);

    if (!auth || auth.role !== UserRoleEnum.STUDENT) {
        return (
            <div className="page">
                <p>Redirecting…</p>
            </div>
        );
    }

    if (isForbiddenOrNotFound) {
        return (
            <div className="page">
                <p role="alert" className="error">Course not found or you are not enrolled.</p>
                <div className="page-actions">
                    <button type="button" className="back-button" onClick={() => navigate('/lms')}>← Back to my courses</button>
                </div>
            </div>
        );
    }

    if (error) {
        return <p role="alert" className="error">{error}</p>;
    }

    if (!courseWithLessons) {
        return <p>Loading…</p>;
    }

    const { lessons } = courseWithLessons;

    return (
        <div className="page">
            <div className="page-actions">
                <button type="button" className="back-button" onClick={() => navigate('/lms')}>← Back to my courses</button>
            </div>
            <h1>{courseWithLessons.title}</h1>
            <p>
                {courseWithLessons.subject} · Year {courseWithLessons.yearFrom}
                {courseWithLessons.yearTo !== courseWithLessons.yearFrom ? `–${courseWithLessons.yearTo}` : ''}
            </p>
            {lessons.length === 0 ? (
                <p>No lessons available yet.</p>
            ) : (
                <ol className="lesson-list">
                    {lessons.map((lesson) => (
                        <li key={lesson.id} className="lesson-item">
                            <button type="button" onClick={() => navigate(`/lms/lessons/${lesson.id}`)}>
                                {lesson.title}
                            </button>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
};
