import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserRoleEnum } from '@mes/shared';
import { MemoryRouter } from 'react-router-dom';
import type { IAuthTokenResponse } from '@mes/shared';

vi.mock('../api/apiClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../api/apiClient')>();

    return { ...actual, apiRequest: vi.fn() };
});

vi.mock('../auth/authStore', () => ({
    useAuth: vi.fn(() => null),
    authStore: {
        getState: vi.fn(() => null),
        setState: vi.fn(),
        clear: vi.fn(),
        subscribe: vi.fn(() => () => {}),
    },
}));

import { apiRequest } from '../api/apiClient';
import { authStore } from '../auth/authStore';
import { LoginPage } from './LoginPage';

const TOKEN_RESPONSE: IAuthTokenResponse = {
    accessToken: 'test.access.token',
    expiresIn: 900,
};

const renderLogin = (): void => {
    render(
        <MemoryRouter>
            <LoginPage />
        </MemoryRouter>,
    );
};

describe('LoginPage', () => {
    beforeEach(() => {
        vi.mocked(authStore.setState).mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders email, password fields and a submit button', () => {
        renderLogin();

        expect(screen.getByLabelText(/email/i)).toBeTruthy();
        expect(screen.getByLabelText(/password/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    });

    it('stores token and navigates when ADMIN credentials are correct', async () => {
        vi.mocked(apiRequest)
            .mockResolvedValueOnce(TOKEN_RESPONSE)
            .mockResolvedValueOnce({ id: 3, role: UserRoleEnum.ADMIN, email: 'admin@mes.test' });

        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email/i), 'admin@mes.test');
        await user.type(screen.getByLabelText(/password/i), 'password123');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(vi.mocked(authStore.setState)).toHaveBeenCalledWith(
                expect.objectContaining({ accessToken: 'test.access.token', role: UserRoleEnum.ADMIN }),
            );
        });
    });

    it('shows error message and does NOT store token when role is PARENT (non-ADMIN)', async () => {
        vi.mocked(apiRequest)
            .mockResolvedValueOnce(TOKEN_RESPONSE)
            .mockResolvedValueOnce({ id: 1, role: UserRoleEnum.PARENT, email: 'parent@mes.test' });

        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email/i), 'parent@mes.test');
        await user.type(screen.getByLabelText(/password/i), 'password123');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        await screen.findByRole('alert');
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toMatch(/admin access only/i);
        expect(vi.mocked(authStore.setState)).not.toHaveBeenCalled();
    });

    it('shows API error message when login request fails', async () => {
        const { ApiError } = await import('../api/apiClient');
        vi.mocked(apiRequest).mockRejectedValueOnce(
            new ApiError(401, { message: 'Invalid credentials', code: 'AUTH_INVALID_CREDENTIALS', requestId: 'req-1' }),
        );

        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email/i), 'nobody@mes.test');
        await user.type(screen.getByLabelText(/password/i), 'wrongpassword1');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        await screen.findByRole('alert');
        expect(vi.mocked(authStore.setState)).not.toHaveBeenCalled();
    });
});
