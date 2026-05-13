import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IInvitationMetaResponse } from '@mes/shared';
import { UserRoleEnum, InvitationStatusEnum } from '@mes/shared';
import { ApiError } from '../api/apiClient';
import { OnboardPage } from './OnboardPage';

vi.mock('../api/invitationsApi');
vi.mock('../router/router', () => ({ navigate: vi.fn() }));
vi.mock('../auth/decodeJwtPayload');

import { fetchInvitationMeta, redeemInvitation } from '../api/invitationsApi';
import { navigate } from '../router/router';
import { decodeJwtPayload } from '../auth/decodeJwtPayload';

const STUB_META: IInvitationMetaResponse = {
    courseTitle: 'Maths Year 7',
    parentEmail: 'parent@example.com',
    studentEmail: 'student@example.com',
    expiresAt: '2026-06-01T00:00:00.000Z',
    status: InvitationStatusEnum.ISSUED,
};

const STUB_TOKEN = 'invite-token-abc';
const STUB_ACCESS_TOKEN = 'access.token.stub';

const fillForm = async (
    user: ReturnType<typeof userEvent.setup>,
    overrides: Partial<{
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        password: string;
        confirmPassword: string;
    }> = {},
): Promise<void> => {
    const values = {
        firstName: 'Alice',
        lastName: 'Smith',
        dateOfBirth: '2010-03-15',
        password: 'Secret1234',
        confirmPassword: 'Secret1234',
        ...overrides,
    };

    await user.type(screen.getByLabelText(/first name/i), values.firstName);
    await user.type(screen.getByLabelText(/last name/i), values.lastName);
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: values.dateOfBirth } });
    await user.type(screen.getByLabelText(/^password$/i), values.password);
    await user.type(screen.getByLabelText(/confirm password/i), values.confirmPassword);
};

describe('OnboardPage form submission', () => {
    beforeEach(() => {
        vi.mocked(fetchInvitationMeta).mockResolvedValue(STUB_META);
        vi.mocked(redeemInvitation).mockResolvedValue({ accessToken: STUB_ACCESS_TOKEN, expiresIn: 900 });
        vi.mocked(decodeJwtPayload).mockReturnValue({ sub: 1, role: UserRoleEnum.STUDENT });
    });

    afterEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('calls redeemInvitation with the correct payload and navigates to /lms on success', async () => {
        const user = userEvent.setup();
        render(<OnboardPage token={STUB_TOKEN} />);

        await screen.findByText(/welcome to maths year 7/i);
        await fillForm(user);
        await user.click(screen.getByRole('button', { name: /create account/i }));

        expect(vi.mocked(redeemInvitation)).toHaveBeenCalledWith({
            token: STUB_TOKEN,
            firstName: 'Alice',
            lastName: 'Smith',
            dateOfBirth: '2010-03-15',
            password: 'Secret1234',
        });
        expect(vi.mocked(navigate)).toHaveBeenCalledWith('/lms');
    });

    it('does not submit when required fields are empty', async () => {
        const user = userEvent.setup();
        render(<OnboardPage token={STUB_TOKEN} />);

        await screen.findByText(/welcome to maths year 7/i);
        await user.click(screen.getByRole('button', { name: /create account/i }));

        expect(vi.mocked(redeemInvitation)).not.toHaveBeenCalled();
    });

    it('shows a password mismatch error and does not submit', async () => {
        const user = userEvent.setup();
        render(<OnboardPage token={STUB_TOKEN} />);

        await screen.findByText(/welcome to maths year 7/i);
        await fillForm(user, { confirmPassword: 'Different1' });
        await user.click(screen.getByRole('button', { name: /create account/i }));

        await screen.findByText(/passwords do not match/i);
        expect(vi.mocked(redeemInvitation)).not.toHaveBeenCalled();
    });

    it('shows an email conflict message when the server returns INVITATION_EMAIL_CONFLICT', async () => {
        vi.mocked(redeemInvitation).mockRejectedValue(
            new ApiError(410, { message: 'Conflict', code: 'INVITATION_EMAIL_CONFLICT', requestId: 'req-1' }),
        );

        const user = userEvent.setup();
        render(<OnboardPage token={STUB_TOKEN} />);

        await screen.findByText(/welcome to maths year 7/i);
        await fillForm(user);
        await user.click(screen.getByRole('button', { name: /create account/i }));

        await screen.findByText(/account with this email already exists/i);
        expect(vi.mocked(navigate)).not.toHaveBeenCalled();
    });

    it('shows a redeemed message without the form when meta status is REDEEMED', async () => {
        vi.mocked(fetchInvitationMeta).mockResolvedValue({ ...STUB_META, status: InvitationStatusEnum.REDEEMED });

        render(<OnboardPage token={STUB_TOKEN} />);

        await screen.findByText(/invitation has already been used/i);
        expect(screen.queryByRole('button', { name: /create account/i })).toBeNull();
        expect(vi.mocked(redeemInvitation)).not.toHaveBeenCalled();
    });

    it('shows an expired message without the form when meta status is EXPIRED', async () => {
        vi.mocked(fetchInvitationMeta).mockResolvedValue({
            ...STUB_META,
            status: InvitationStatusEnum.EXPIRED,
            expiresAt: '2020-01-01T00:00:00.000Z',
        });

        render(<OnboardPage token={STUB_TOKEN} />);

        await screen.findByText(/invitation link has expired/i);
        expect(screen.queryByRole('button', { name: /create account/i })).toBeNull();
        expect(vi.mocked(redeemInvitation)).not.toHaveBeenCalled();
    });
});
