import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UserRoleEnum } from '@mes/shared';
import type { IPaginated } from '@mes/shared';
import type { IAdminParentRow } from '@mes/shared';
import type { IAuthState } from '../auth/authStore';

vi.mock('../api/adminApi', () => ({
    fetchParents: vi.fn(),
}));

vi.mock('../auth/authStore', () => ({
    useAuth: vi.fn(),
    authStore: {
        getState: vi.fn(),
        setState: vi.fn(),
        clear: vi.fn(),
        subscribe: vi.fn(() => () => {}),
    },
}));

import { fetchParents } from '../api/adminApi';
import { useAuth } from '../auth/authStore';
import { ParentsPage } from './ParentsPage';

const ADMIN_AUTH: IAuthState = {
    accessToken: 'admin.token',
    userId: 3,
    role: UserRoleEnum.ADMIN,
    email: 'admin@mes.test',
};

const buildPaginatedParents = (rows: IAdminParentRow[], total = rows.length): IPaginated<IAdminParentRow> => ({
    data: rows,
    total,
    page: 1,
    limit: 20,
});

const buildParentRow = (overrides?: Partial<IAdminParentRow>): IAdminParentRow => ({
    id: 1,
    email: 'parent@mes.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const renderPage = (): void => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <ParentsPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
};

describe('ParentsPage', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue(ADMIN_AUTH);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state before fetch resolves', () => {
        vi.mocked(fetchParents).mockImplementation(() => new Promise(() => {}));

        renderPage();

        expect(screen.getByText(/loading/i)).toBeTruthy();
    });

    it('renders parent rows when fetch succeeds', async () => {
        vi.mocked(fetchParents).mockResolvedValue(
            buildPaginatedParents([
                buildParentRow({ id: 1, email: 'alice@mes.test', firstName: 'Alice', lastName: 'Smith' }),
                buildParentRow({ id: 2, email: 'bob@mes.test', firstName: 'Bob', lastName: 'Jones' }),
            ], 2),
        );

        renderPage();

        await screen.findByText('alice@mes.test');
        expect(screen.getByText('bob@mes.test')).toBeTruthy();
        expect(screen.getByText('Total: 2')).toBeTruthy();
    });

    it('renders empty-row message when no parents exist', async () => {
        vi.mocked(fetchParents).mockResolvedValue(buildPaginatedParents([], 0));

        renderPage();

        await screen.findByText(/no parents found/i);
    });

    it('calls fetchParents again with page=2 when Next button is clicked', async () => {
        vi.mocked(fetchParents).mockResolvedValue(
            buildPaginatedParents(
                [buildParentRow()],
                // total > limit so the Next button is enabled
                50,
            ),
        );

        const user = userEvent.setup();
        renderPage();

        await screen.findByText('parent@mes.test');

        const nextBtn = screen.getByRole('button', { name: /next/i });
        await user.click(nextBtn);

        // After click, a second call for page=2 is made.
        expect(vi.mocked(fetchParents)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(fetchParents)).toHaveBeenLastCalledWith(
            expect.objectContaining({ page: 2 }),
            ADMIN_AUTH.accessToken,
        );
    });

    it('renders an error alert when fetch fails with a 4xx error', async () => {
        // The page's retry function bails immediately on 4xx — use a status-bearing error.
        const err = Object.assign(new Error('Forbidden'), { status: 403 });
        vi.mocked(fetchParents).mockRejectedValue(err);

        renderPage();

        await screen.findByRole('alert');
    });
});
