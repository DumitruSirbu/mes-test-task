import { useEffect, useState, type ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import type { ILessonResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';

interface IProps {
    lessonId: string;
}

export const LmsLessonPage = ({ lessonId }: IProps): ReactElement => {
    const auth = useAuth();
    const [lesson, setLesson] = useState<ILessonResponse | null>(null);
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
                const detail = await apiRequest<ILessonResponse>(
                    `/lessons/${encodeURIComponent(lessonId)}`,
                    { token: auth.accessToken },
                );

                if (!cancelled) {
                    setLesson(detail);
                }
            } catch (err) {
                if (!cancelled) {
                    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
                        setIsForbiddenOrNotFound(true);
                    } else {
                        setError(err instanceof ApiError ? err.message : 'Failed to load lesson.');
                    }
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [auth, lessonId]);

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
                <p role="alert" className="error">Lesson not found or you are not enrolled in this course.</p>
                <div className="page-actions">
                    <button type="button" className="back-button" onClick={() => navigate('/lms')}>← Back to my courses</button>
                </div>
            </div>
        );
    }

    if (error) {
        return <p role="alert" className="error">{error}</p>;
    }

    if (!lesson) {
        return <p>Loading…</p>;
    }

    return (
        <div className="page">
            <div className="page-actions">
                <button type="button" className="back-button" onClick={() => navigate(`/lms/courses/${lesson.courseId}`)}>← Back to course</button>
            </div>
            <h1>{lesson.title}</h1>
            <p style={{ whiteSpace: 'pre-wrap' }}>{lesson.body}</p>
        </div>
    );
};
