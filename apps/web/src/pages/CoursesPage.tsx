import { useEffect, useState, type ReactElement } from 'react';
import type { ICourseResponse } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { formatPricePence } from '../util/formatPrice';
import { useAuth } from '../auth/authStore';

/**
 * Public catalog listing. The backend exposes `GET /courses` as `@Public()` so anonymous
 * browsers see the same list a logged-in parent sees.
 */
export const CoursesPage = (): ReactElement => {
    const [courses, setCourses] = useState<ICourseResponse[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const auth = useAuth();

    useEffect(() => {
        let cancelled = false;

        const load = async (): Promise<void> => {
            try {
                const list = await apiRequest<ICourseResponse[]>('/courses');

                if (!cancelled) {
                    setCourses(list);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : 'Failed to load courses.');
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, []);

    if (error) {
        return <p role="alert" className="error">{error}</p>;
    }

    if (!courses) {
        return <p>Loading courses…</p>;
    }

    return (
        <div className="page">
            <h1>Courses</h1>
            <p>{auth ? `Logged in as ${auth.email}.` : 'Browse the catalog. Log in as a parent to purchase.'}</p>
            <ul className="course-list">
                {courses.map((course) => (
                    <li key={course.id} className="course-card">
                        <h2>{course.title}</h2>
                        <p>
                            {course.subject} · Year {course.yearFrom}
                            {course.yearTo !== course.yearFrom ? `–${course.yearTo}` : ''}
                        </p>
                        <p className="price">{formatPricePence(course.pricePence)}</p>
                        <a href={`#/courses/${course.id}`}>View details</a>
                    </li>
                ))}
            </ul>
        </div>
    );
};
