import { useEffect, useState, type ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import type { ICourseResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';

export const LmsPage = (): ReactElement => {
    const auth = useAuth();
    const [courses, setCourses] = useState<ICourseResponse[] | null>(null);
    const [error, setError] = useState<string | null>(null);

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
                const list = await apiRequest<ICourseResponse[]>('/me/courses', {
                    token: auth.accessToken,
                });

                if (!cancelled) {
                    setCourses(list);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : 'Failed to load enrolled courses.');
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [auth]);

    if (!auth || auth.role !== UserRoleEnum.STUDENT) {
        return (
            <div className="page">
                <p>Redirecting…</p>
            </div>
        );
    }

    if (error) {
        return <p role="alert" className="error">{error}</p>;
    }

    if (!courses) {
        return <p>Loading courses…</p>;
    }

    if (courses.length === 0) {
        return (
            <div className="page">
                <h1>My Courses</h1>
                <p>No enrolled courses yet.</p>
            </div>
        );
    }

    return (
        <div className="page">
            <h1>My Courses</h1>
            <ul className="course-list">
                {courses.map((course) => (
                    <li key={course.id} className="course-card">
                        <h2>{course.title}</h2>
                        <p>
                            {course.subject} · Year {course.yearFrom}
                            {course.yearTo !== course.yearFrom ? `–${course.yearTo}` : ''}
                        </p>
                        <button type="button" onClick={() => navigate(`/lms/courses/${course.id}`)}>
                            View lessons
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};
