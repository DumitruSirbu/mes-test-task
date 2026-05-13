import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IInvitationMetaResponse } from '@mes/shared';
import { InvitationStatusEnum } from '@mes/shared';
import { ApiError } from './apiClient';
import { fetchInvitationMeta, redeemInvitation } from './invitationsApi';

/**
 * `fetch` is mocked at the module level so tests remain fast and network-free.
 * Each test overrides `mockImplementation` to return a specific response.
 */

const STUB_META: IInvitationMetaResponse = {
    courseTitle: 'Maths Year 7',
    parentEmail: 'parent@example.com',
    studentEmail: 'student@example.com',
    expiresAt: '2026-06-01T00:00:00.000Z',
    status: InvitationStatusEnum.ISSUED,
};

const STUB_REDEEM_RESPONSE = {
    accessToken: 'eyJhbGciOiJIUzI1NiJ9.stub.signature',
    expiresIn: 900,
};

function buildFetchResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

describe('invitationsApi', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('fetchInvitationMeta', () => {
        it('returns parsed meta body on 200', async () => {
            vi.mocked(fetch).mockResolvedValue(buildFetchResponse(STUB_META, 200));

            const result = await fetchInvitationMeta('abc123');

            expect(result).toEqual(STUB_META);
        });

        it('encodes the token in the URL path', async () => {
            vi.mocked(fetch).mockResolvedValue(buildFetchResponse(STUB_META, 200));
            const tokenWithSpecialChars = 'tok+en/val=';

            await fetchInvitationMeta(tokenWithSpecialChars);

            const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
            expect(calledUrl).toContain(encodeURIComponent(tokenWithSpecialChars));
        });

        it('throws ApiError with the correct status and code on non-2xx response', async () => {
            const errorBody = { code: 'INVITATION_NOT_FOUND', message: 'Invalid link', requestId: 'req-1' };
            vi.mocked(fetch).mockResolvedValue(buildFetchResponse(errorBody, 410));

            await expect(fetchInvitationMeta('bad-token')).rejects.toThrow(ApiError);

            try {
                await fetchInvitationMeta('bad-token');
            } catch (err) {
                expect(err).toBeInstanceOf(ApiError);
                expect((err as ApiError).status).toBe(410);
                expect((err as ApiError).code).toBe('INVITATION_NOT_FOUND');
            }
        });
    });

    describe('redeemInvitation', () => {
        const REDEEM_BODY = {
            token: 'validtoken',
            firstName: 'Alice',
            lastName: 'Smith',
            dateOfBirth: '2010-03-15',
            password: 'Secret1234',
        };

        it('sends POST and returns accessToken + expiresIn on success', async () => {
            vi.mocked(fetch).mockResolvedValue(buildFetchResponse(STUB_REDEEM_RESPONSE, 201));

            const result = await redeemInvitation(REDEEM_BODY);

            expect(result.accessToken).toBe(STUB_REDEEM_RESPONSE.accessToken);
            expect(result.expiresIn).toBe(STUB_REDEEM_RESPONSE.expiresIn);

            const [, fetchInit] = vi.mocked(fetch).mock.calls[0];
            expect((fetchInit as RequestInit).method).toBe('POST');
        });

        it('serialises the body as JSON in the request', async () => {
            vi.mocked(fetch).mockResolvedValue(buildFetchResponse(STUB_REDEEM_RESPONSE, 201));

            await redeemInvitation(REDEEM_BODY);

            const [, fetchInit] = vi.mocked(fetch).mock.calls[0];
            expect(JSON.parse((fetchInit as RequestInit).body as string)).toEqual(REDEEM_BODY);
        });

        it('throws ApiError on 410 INVITATION_ALREADY_REDEEMED', async () => {
            const errorBody = { code: 'INVITATION_ALREADY_REDEEMED', message: 'Already redeemed', requestId: 'req-2' };
            vi.mocked(fetch).mockResolvedValue(buildFetchResponse(errorBody, 410));

            await expect(redeemInvitation(REDEEM_BODY)).rejects.toThrow(ApiError);

            try {
                await redeemInvitation(REDEEM_BODY);
            } catch (err) {
                expect((err as ApiError).status).toBe(410);
                expect((err as ApiError).code).toBe('INVITATION_ALREADY_REDEEMED');
            }
        });
    });
});
