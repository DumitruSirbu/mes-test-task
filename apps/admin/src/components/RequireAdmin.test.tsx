import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UserRoleEnum } from '@mes/shared';

vi.mock('../auth/authStore', () => ({
    useAuth: vi.fn(),
    authStore: {
        getState: vi.fn(),
        setState: vi.fn(),
        clear: vi.fn(),
        subscribe: vi.fn(() => () => {}),
    },
}));

import { useAuth } from '../auth/authStore';
import { RequireAdmin } from './RequireAdmin';
import type { IAuthState } from '../auth/authStore';

const ADMIN_AUTH: IAuthState = {
    accessToken: 'admin.token',
    userId: 3,
    role: UserRoleEnum.ADMIN,
    email: 'admin@mes.test',
};

const renderGuard = (auth: IAuthState | null): void => {
    vi.mocked(useAuth).mockReturnValue(auth);

    render(
        <MemoryRouter initialEntries={['/protected']}>
            <Routes>
                <Route element={<RequireAdmin />}>
                    <Route path="/protected" element={<div>Protected content</div>} />
                </Route>
                <Route path="/login" element={<div>Login page</div>} />
            </Routes>
        </MemoryRouter>,
    );
};

describe('RequireAdmin', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders protected content when user is ADMIN', () => {
        renderGuard(ADMIN_AUTH);

        expect(screen.getByText('Protected content')).toBeTruthy();
    });

    it('redirects to /login when user is unauthenticated (auth is null)', () => {
        renderGuard(null);

        expect(screen.getByText('Login page')).toBeTruthy();
        expect(screen.queryByText('Protected content')).toBeNull();
    });

    it('shows access-denied message when authenticated user is PARENT (non-ADMIN)', () => {
        renderGuard({ ...ADMIN_AUTH, role: UserRoleEnum.PARENT, email: 'parent@mes.test' });

        expect(screen.getByText(/admin access only/i)).toBeTruthy();
        expect(screen.queryByText('Protected content')).toBeNull();
        expect(screen.queryByText('Login page')).toBeNull();
    });

    it('shows access-denied message when authenticated user is STUDENT (non-ADMIN)', () => {
        renderGuard({ ...ADMIN_AUTH, role: UserRoleEnum.STUDENT, email: 'student@mes.test' });

        expect(screen.getByText(/admin access only/i)).toBeTruthy();
        expect(screen.queryByText('Protected content')).toBeNull();
    });
});
