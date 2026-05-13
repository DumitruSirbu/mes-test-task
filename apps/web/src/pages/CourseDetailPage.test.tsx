import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserRoleEnum, CourseSubjectEnum } from '@mes/shared';
import type { ICourseResponse } from '@mes/shared';
import type { IAuthState } from '../auth/authStore';

vi.mock('../api/apiClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../api/apiClient')>();

    return { ...actual, apiRequest: vi.fn() };
});
vi.mock('../auth/authStore', () => ({
    useAuth: vi.fn(),
    authStore: { getState: vi.fn(), setState: vi.fn(), clear: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../router/router', () => ({ navigate: vi.fn(), useRoutePath: vi.fn(() => '/courses/7') }));

import { apiRequest } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { CourseDetailPage } from './CourseDetailPage';

const PARENT_AUTH: IAuthState = {
    accessToken: 'parent.access.token',
    userId: 10,
    role: UserRoleEnum.PARENT,
    email: 'parent@example.com',
};

const STUB_COURSE: ICourseResponse = {
    id: 7,
    subject: CourseSubjectEnum.MATHS,
    yearFrom: 7,
    yearTo: 7,
    title: 'Maths Year 7',
    pricePence: 19900,
};

const FLASH_KEY = 'mes.checkoutFlash.v1';

describe('CourseDetailPage — already-enrolled flash banner', () => {
    function stubCourseDetailCalls(): void {
        // CourseDetailPage makes up to three apiRequest calls when auth is PARENT:
        //   1. GET /courses/{id}     → ICourseResponse
        //   2. GET /me/purchases     → IPurchaseResponse[]
        //   3. GET /courses          → ICourseResponse[]  (all courses for student grouping)
        // We stub them in call order so each resolves to the correct shape.
        vi.mocked(apiRequest)
            .mockResolvedValueOnce(STUB_COURSE)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
    }

    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue(PARENT_AUTH);
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it('renders the already-enrolled status banner when a matching flash is present in sessionStorage', async () => {
        stubCourseDetailCalls();
        sessionStorage.setItem(
            FLASH_KEY,
            JSON.stringify({ kind: 'already-enrolled', studentEmail: 'student@example.com', courseId: '7' }),
        );

        render(<CourseDetailPage courseId="7" />);

        const banner = await screen.findByRole('status');
        expect(banner.textContent).toContain('student@example.com');
        expect(banner.textContent).toContain('already enrolled');
    });

    it('clears the flash from sessionStorage after mount so a page refresh does not re-show the banner', async () => {
        stubCourseDetailCalls();
        sessionStorage.setItem(
            FLASH_KEY,
            JSON.stringify({ kind: 'already-enrolled', studentEmail: 'student@example.com', courseId: '7' }),
        );

        render(<CourseDetailPage courseId="7" />);

        await screen.findByRole('status');
        expect(sessionStorage.getItem(FLASH_KEY)).toBeNull();
    });

    it('does not render the banner when sessionStorage contains no flash', async () => {
        stubCourseDetailCalls();

        render(<CourseDetailPage courseId="7" />);

        await screen.findByRole('heading', { name: 'Maths Year 7' });
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('does not render the banner — and preserves the flash for the right page — when the flash courseId does not match the current courseId', async () => {
        stubCourseDetailCalls();
        const flashPayload = { kind: 'already-enrolled', studentEmail: 'student@example.com', courseId: '99' };
        sessionStorage.setItem(FLASH_KEY, JSON.stringify(flashPayload));

        render(<CourseDetailPage courseId="7" />);

        await screen.findByRole('heading', { name: 'Maths Year 7' });
        expect(screen.queryByRole('status')).toBeNull();
        // The flash must survive so the intended /courses/99 page can consume it on its own mount.
        expect(JSON.parse(sessionStorage.getItem(FLASH_KEY)!)).toEqual(flashPayload);
    });

    it('discards a malformed flash entry from sessionStorage', async () => {
        stubCourseDetailCalls();
        sessionStorage.setItem(FLASH_KEY, 'not-valid-json{{');

        render(<CourseDetailPage courseId="7" />);

        await screen.findByRole('heading', { name: 'Maths Year 7' });
        expect(screen.queryByRole('status')).toBeNull();
        expect(sessionStorage.getItem(FLASH_KEY)).toBeNull();
    });
});
