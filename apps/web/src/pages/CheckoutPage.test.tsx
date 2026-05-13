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
vi.mock('../router/router', () => ({ navigate: vi.fn(), useRoutePath: vi.fn(() => '/checkout/7') }));
vi.mock('../util/uuid', () => ({ generateUuid: vi.fn(() => 'fixed-uuid-1234') }));

import { apiRequest } from '../api/apiClient';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';
import { CheckoutPage } from './CheckoutPage';

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

function buildApiError(status: number, code: string, message = 'Error'): ApiError {
    return new ApiError(status, { message, code, requestId: 'req-test' });
}

describe('CheckoutPage — PURCHASE_ALREADY_EXISTS_FOR_STUDENT handling', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue(PARENT_AUTH);
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it('writes the already-enrolled flash to sessionStorage and navigates to the course page on 409 PURCHASE_ALREADY_EXISTS_FOR_STUDENT', async () => {
        vi.mocked(apiRequest)
            .mockResolvedValueOnce(STUB_COURSE)
            .mockRejectedValueOnce(buildApiError(409, 'PURCHASE_ALREADY_EXISTS_FOR_STUDENT', 'You have already purchased this course for this student.'));

        const user = userEvent.setup();
        render(<CheckoutPage courseId="7" />);

        const emailInput = await screen.findByLabelText(/student email/i);
        await user.type(emailInput, 'student@example.com');
        await user.click(screen.getByRole('button', { name: /buy for/i }));

        const raw = sessionStorage.getItem('mes.checkoutFlash.v1');
        expect(raw).not.toBeNull();

        const flash = JSON.parse(raw!);
        expect(flash).toEqual({
            kind: 'already-enrolled',
            studentEmail: 'student@example.com',
            courseId: '7',
        });

        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/courses/7');
    });

    it('does not write sessionStorage flash and shows an inline error for a generic 422', async () => {
        vi.mocked(apiRequest)
            .mockResolvedValueOnce(STUB_COURSE)
            .mockRejectedValueOnce(buildApiError(422, 'VALIDATION_FAILED', 'Validation failed.'));

        const user = userEvent.setup();
        render(<CheckoutPage courseId="7" />);

        const emailInput = await screen.findByLabelText(/student email/i);
        await user.type(emailInput, 'student@example.com');
        await user.click(screen.getByRole('button', { name: /buy for/i }));

        await screen.findByRole('alert');
        expect(sessionStorage.getItem('mes.checkoutFlash.v1')).toBeNull();
        expect(vi.mocked(navigate)).not.toHaveBeenCalledWith(expect.stringContaining('/courses/'));
    });
});
