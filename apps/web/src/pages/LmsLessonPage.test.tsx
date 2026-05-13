import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserRoleEnum } from '@mes/shared';
import type { ILessonResponse } from '@mes/shared';
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
vi.mock('../router/router', () => ({ navigate: vi.fn(), useRoutePath: vi.fn(() => '/lms/lessons/lesson-1') }));

import { apiRequest } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';
import { LmsLessonPage } from './LmsLessonPage';

const STUDENT_AUTH: IAuthState = {
    accessToken: 'student.access.token',
    userId: 42,
    role: UserRoleEnum.STUDENT,
    email: 'student@example.com',
};

const STUB_LESSON: ILessonResponse = {
    id: 'cccccccc-0000-0000-0000-000000000001',
    courseId: 7,
    title: 'Introduction to Algebra',
    body: 'In this lesson we introduce algebraic concepts.',
    orderIndex: 1,
    createdAt: '2026-05-13T10:00:00.000Z',
};

function buildFetchError(status: number, code: string): ApiError {
    return new ApiError(status, { message: 'Error', code, requestId: 'req-test' });
}

describe('LmsLessonPage', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue(STUDENT_AUTH);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state before the fetch resolves', () => {
        vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));

        render(<LmsLessonPage lessonId="cccccccc-0000-0000-0000-000000000001" />);

        screen.getByText(/loading/i);
    });

    it('renders the lesson title and body on success', async () => {
        vi.mocked(apiRequest).mockResolvedValue(STUB_LESSON);

        render(<LmsLessonPage lessonId={STUB_LESSON.id} />);

        await screen.findByRole('heading', { name: 'Introduction to Algebra' });
        screen.getByText('In this lesson we introduce algebraic concepts.');
    });

    it('"Back to course" button navigates using the courseId from the lesson response', async () => {
        vi.mocked(apiRequest).mockResolvedValue(STUB_LESSON);
        const user = userEvent.setup();

        render(<LmsLessonPage lessonId={STUB_LESSON.id} />);

        const backButton = await screen.findByRole('button', { name: /back to course/i });
        await user.click(backButton);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith(`/lms/courses/${STUB_LESSON.courseId}`);
    });

    it('renders error state on 403 NOT_ENROLLED', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(403, 'NOT_ENROLLED'));

        render(<LmsLessonPage lessonId="cccccccc-0000-0000-0000-000000000001" />);

        const alert = await screen.findByRole('alert');
        expect(alert.textContent?.toLowerCase()).toContain('not enrolled');
    });

    it('renders error state on 404 LESSON_NOT_FOUND', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(404, 'LESSON_NOT_FOUND'));

        render(<LmsLessonPage lessonId="ffffffff-ffff-ffff-ffff-ffffffffffff" />);

        await screen.findByRole('alert');
    });

    it('renders generic error state on 500', async () => {
        vi.mocked(apiRequest).mockRejectedValue(buildFetchError(500, 'INTERNAL_SERVER_ERROR'));

        render(<LmsLessonPage lessonId="cccccccc-0000-0000-0000-000000000001" />);

        await screen.findByRole('alert');
    });

    it('redirects to /login when auth is null', () => {
        vi.mocked(useAuth).mockReturnValue(null);

        render(<LmsLessonPage lessonId="cccccccc-0000-0000-0000-000000000001" />);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/login');
    });

    it('redirects to /login when the authenticated user is not a STUDENT', () => {
        vi.mocked(useAuth).mockReturnValue({ ...STUDENT_AUTH, role: UserRoleEnum.PARENT });

        render(<LmsLessonPage lessonId="cccccccc-0000-0000-0000-000000000001" />);

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/login');
    });
});
