import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserRoleEnum, CourseSubjectEnum } from '@mes/shared';
import type { ICourseWithLessonsResponse } from '@mes/shared';
import { ApiError } from '../api/apiClient';
import type { IAuthState } from '../auth/authStore';

vi.mock('../api/apiClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../api/apiClient')>();

    return { ...actual, apiRequest: vi.fn() };
});
vi.mock('../auth/authStore', () => ({
    useAuth: vi.fn(),
    authStore: { getState: vi.fn(), setState: vi.fn(), clear: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../router/router', () => ({ navigate: vi.fn(), useRoutePath: vi.fn(() => '/lms/courses/7') }));

import { apiRequest } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';
import { LmsCourseDetailPage } from './LmsCourseDetailPage';

const STUDENT_AUTH: IAuthState = {
    accessToken: 'student.access.token',
    userId: 42,
    role: UserRoleEnum.STUDENT,
    email: 'student@example.com',
};

const STUB_COURSE_WITH_LESSONS: ICourseWithLessonsResponse = {
    id: 7,
    subject: CourseSubjectEnum.MATHS,
    yearFrom: 7,
    yearTo: 7,
    title: 'Maths Year 7',
    pricePence: 19900,
    lessons: [
        {
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            courseId: 7,
            title: 'Lesson 1: Intro',
            body: 'Introduction to Maths Year 7.',
            orderIndex: 1,
            createdAt: '2026-05-13T10:00:00.000Z',
        },
        {
            id: 'aaaaaaaa-0000-0000-0000-000000000002',
            courseId: 7,
            title: 'Lesson 2: Addition',
            body: 'Adding numbers together.',
            orderIndex: 2,
            createdAt: '2026-05-13T10:01:00.000Z',
        },
        {
            id: 'aaaaaaaa-0000-0000-0000-000000000003',
            courseId: 7,
            title: 'Lesson 3: Subtraction',
            body: 'Subtracting numbers.',
            orderIndex: 3,
            createdAt: '2026-05-13T10:02:00.000Z',
        },
    ],
};

function buildFetchError(status: number, code: string): ApiError {
    return new ApiError(status, { message: 'Error', code, requestId: 'req-test' });
}

describe('LmsCourseDetailPage', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue(STUDENT_AUTH);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state before the fetch resolves', () => {
        vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));

        render(<LmsCourseDetailPage courseId="7" />);

        screen.getByText(/loading/i);
    });

    it('renders the course title and all lessons ordered by orderIndex', async () => {
        vi.mocked(apiRequest).mockResolvedValue(STUB_COURSE_WITH_LESSONS);

        render(<LmsCourseDetailPage courseId="7" />);

        await screen.findByRole('heading', { name: 'Maths Year 7' });

        const listItems = screen.getAllByRole('listitem');
        expect(listItems).toHaveLength(3);

        // Assert the visual order matches orderIndex ascending.
        expect(listItems[0].textContent).toContain('Lesson 1: Intro');
        expect(listItems[1].textContent).toContain('Lesson 2: Addition');
        expect(listItems[2].textContent).toContain('Lesson 3: Subtraction');
    });

    it('renders empty-lessons message when the course has no lessons', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ ...STUB_COURSE_WITH_LESSONS, lessons: [] });

        render(<LmsCourseDetailPage courseId="7" />);

        await screen.findByText(/no lessons available yet/i);
        expect(screen.queryByRole('listitem')).toBeNull();
    });

    it('renders error state on 403 NOT_ENROLLED', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(403, 'NOT_ENROLLED'));

        render(<LmsCourseDetailPage courseId="7" />);

        // The alert element contains the not-enrolled message.
        const alert = await screen.findByRole('alert');
        expect(alert.textContent?.toLowerCase()).toContain('not enrolled');
    });

    it('renders error state on 404', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(404, 'COURSE_NOT_FOUND'));

        render(<LmsCourseDetailPage courseId="99" />);

        // findByRole throws if absent — the presence is the assertion.
        await screen.findByRole('alert');
    });

    it('renders generic error state on 500', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(500, 'INTERNAL_SERVER_ERROR'));

        render(<LmsCourseDetailPage courseId="7" />);

        await screen.findByRole('alert');
    });

    it('lesson button navigates to the lesson detail page', async () => {
        vi.mocked(apiRequest).mockResolvedValue(STUB_COURSE_WITH_LESSONS);

        const user = userEvent.setup();
        render(<LmsCourseDetailPage courseId="7" />);

        const lessonBtn = await screen.findByRole('button', { name: 'Lesson 1: Intro' });
        await user.click(lessonBtn);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/lms/lessons/aaaaaaaa-0000-0000-0000-000000000001');
    });

    it('redirects to /login when auth is null', () => {
        vi.mocked(useAuth).mockReturnValue(null);

        render(<LmsCourseDetailPage courseId="7" />);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/login');
    });
});
