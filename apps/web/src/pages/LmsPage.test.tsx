import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserRoleEnum, CourseSubjectEnum } from '@mes/shared';
import type { ICourseResponse } from '@mes/shared';
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
vi.mock('../router/router', () => ({ navigate: vi.fn(), useRoutePath: vi.fn(() => '/lms') }));

import { apiRequest } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';
import { LmsPage } from './LmsPage';

const STUDENT_AUTH: IAuthState = {
    accessToken: 'student.access.token',
    userId: 42,
    role: UserRoleEnum.STUDENT,
    email: 'student@example.com',
};

const STUB_COURSES: ICourseResponse[] = [
    {
        id: 7,
        subject: CourseSubjectEnum.MATHS,
        yearFrom: 7,
        yearTo: 7,
        title: 'Maths Year 7',
        pricePence: 19900,
    },
    {
        id: 8,
        subject: CourseSubjectEnum.MATHS,
        yearFrom: 8,
        yearTo: 8,
        title: 'Maths Year 8',
        pricePence: 19900,
    },
];

function buildFetchError(status: number, code: string): ApiError {
    return new ApiError(status, { message: 'Error', code, requestId: 'req-test' });
}

describe('LmsPage', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue(STUDENT_AUTH);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state before the fetch resolves', () => {
        vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));

        render(<LmsPage />);

        // If the element is absent, getByText throws and the test fails.
        screen.getByText(/loading courses/i);
    });

    it('renders the list of enrolled courses when fetch succeeds', async () => {
        vi.mocked(apiRequest).mockResolvedValue(STUB_COURSES);

        render(<LmsPage />);

        // findByText throws if absent after the async cycle, which is the assertion.
        await screen.findByText('Maths Year 7');
        await screen.findByText('Maths Year 8');
    });

    it('renders empty state when the student has no enrolled courses', async () => {
        vi.mocked(apiRequest).mockResolvedValue([]);

        render(<LmsPage />);

        await screen.findByText(/no enrolled courses yet/i);
        expect(screen.queryByRole('listitem')).toBeNull();
    });

    it('renders error state when the fetch returns a 403', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(403, 'AUTH_FORBIDDEN_ROLE'));

        render(<LmsPage />);

        // findByRole('alert') throws if the element never appears.
        await screen.findByRole('alert');
    });

    it('renders error state when the fetch returns a 500', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(500, 'INTERNAL_SERVER_ERROR'));

        render(<LmsPage />);

        await screen.findByRole('alert');
    });

    it('"View lessons" button navigates to the course detail page', async () => {
        vi.mocked(apiRequest).mockResolvedValue([STUB_COURSES[0]]);

        const user = userEvent.setup();
        render(<LmsPage />);

        const btn = await screen.findByRole('button', { name: /view lessons/i });
        await user.click(btn);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/lms/courses/7');
    });

    it('redirects to /login when auth is null', () => {
        vi.mocked(useAuth).mockReturnValue(null);

        render(<LmsPage />);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/login');
    });

    it('redirects to /login when the authenticated user is not a STUDENT', () => {
        vi.mocked(useAuth).mockReturnValue({ ...STUDENT_AUTH, role: UserRoleEnum.PARENT });

        render(<LmsPage />);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/login');
    });
});
