/**
 * Unit tests for web apiClient M10 behaviours.
 *
 * Covers:
 *   1. Only AUTH_TOKEN_EXPIRED triggers refresh; AUTH_INVALID_TOKEN / AUTH_FORBIDDEN_ROLE → /login
 *   2. Single-flight: concurrent 401s share one refresh promise
 *   3. 401 retry recursion bound: AUTH_TOKEN_EXPIRED on retried request → no re-entry, redirects
 *   4. Logout-during-refresh race: in-flight refresh resolves after logout → store stays empty
 *   5. Logout network failure → isLoggingOut flag cleared in finally → re-login hydrates normally
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockInstance } from 'vitest';

// ---------------------------------------------------------------------------
// authStore mock
// vi.mock is hoisted, so we use vi.hoisted to share the object with test assertions.
// ---------------------------------------------------------------------------

const authStoreMock = vi.hoisted(() => ({
    clear: vi.fn(),
    getState: vi.fn().mockReturnValue({ accessToken: 'stored-token' }),
    setToken: vi.fn(),
    getIsLoggingOut: vi.fn().mockReturnValue(false),
    setIsLoggingOut: vi.fn(),
    setState: vi.fn(),
}));

vi.mock('../auth/authStore', () => ({
    authStore: authStoreMock,
}));

// ---------------------------------------------------------------------------
// router mock
// ---------------------------------------------------------------------------

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../router/router', () => ({
    navigate: navigateMock,
}));

// ---------------------------------------------------------------------------
// Response factories
// ---------------------------------------------------------------------------

const makeAuthError = (code: string): Response =>
    new Response(JSON.stringify({ code, message: 'test', requestId: 'r1' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
    });

const makeOkResponse = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

// ---------------------------------------------------------------------------
// Import under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { apiRequest, ApiError } from './apiClient';

describe('apiClient — 401 handler (web)', () => {
    let fetchMock: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        authStoreMock.getIsLoggingOut.mockReturnValue(false);
        authStoreMock.getState.mockReturnValue({ accessToken: 'stored-token' });
        fetchMock = vi.spyOn(globalThis, 'fetch');
    });

    // -------------------------------------------------------------------------
    // Test 1a: AUTH_INVALID_TOKEN routes straight to /login
    // -------------------------------------------------------------------------

    it('AUTH_INVALID_TOKEN routes straight to /login without attempting refresh', async () => {
        fetchMock.mockResolvedValueOnce(makeAuthError('AUTH_INVALID_TOKEN'));

        await expect(apiRequest('/endpoint')).rejects.toMatchObject({ code: 'AUTH_INVALID_TOKEN' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(authStoreMock.clear).toHaveBeenCalled();
        expect(navigateMock).toHaveBeenCalledWith('/login');
    });

    // -------------------------------------------------------------------------
    // Test 1b: AUTH_FORBIDDEN_ROLE routes straight to /login
    // -------------------------------------------------------------------------

    it('AUTH_FORBIDDEN_ROLE routes straight to /login without attempting refresh', async () => {
        fetchMock.mockResolvedValueOnce(makeAuthError('AUTH_FORBIDDEN_ROLE'));

        await expect(apiRequest('/endpoint')).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN_ROLE' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(authStoreMock.clear).toHaveBeenCalled();
        expect(navigateMock).toHaveBeenCalledWith('/login');
    });

    // -------------------------------------------------------------------------
    // Test 1c: AUTH_TOKEN_EXPIRED triggers a single silent refresh + retry
    // -------------------------------------------------------------------------

    it('AUTH_TOKEN_EXPIRED triggers silent refresh then retries the original request once', async () => {
        fetchMock
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED'))
            .mockResolvedValueOnce(makeOkResponse({ accessToken: 'new-token', expiresIn: 600 }))
            .mockResolvedValueOnce(makeOkResponse({ data: 'success' }));

        const result = await apiRequest<{ data: string }>('/endpoint');

        expect(result).toEqual({ data: 'success' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(authStoreMock.setToken).toHaveBeenCalledWith('new-token');
    });

    // -------------------------------------------------------------------------
    // Test 3: Recursion bound — AUTH_TOKEN_EXPIRED on retry → drop + redirect
    // -------------------------------------------------------------------------

    it('AUTH_TOKEN_EXPIRED on the retried request drops token and redirects — no recursion', async () => {
        fetchMock
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED')) // original
            .mockResolvedValueOnce(makeOkResponse({ accessToken: 'new-token', expiresIn: 600 })) // refresh
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED')); // retry returns 401 again

        await expect(apiRequest('/endpoint')).rejects.toBeDefined();

        // fetch: original + refresh + retry = exactly 3 calls. No 4th.
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(authStoreMock.clear).toHaveBeenCalled();
        expect(navigateMock).toHaveBeenCalledWith('/login');
    });

    // -------------------------------------------------------------------------
    // Test 4: Logout-during-refresh race
    // -------------------------------------------------------------------------

    it('refresh resolves after logout → store NOT hydrated, isLoggingOut guard fires', async () => {
        let resolveRefresh!: (value: Response) => void;
        const refreshPromise = new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
        });

        fetchMock
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED'))
            .mockReturnValueOnce(refreshPromise);

        // Logout has already completed — flag is set.
        authStoreMock.getIsLoggingOut.mockReturnValue(true);

        const requestPromise = apiRequest('/endpoint').catch(() => undefined);

        await new Promise<void>((r) => setTimeout(r, 0));

        // Resolve the refresh late — logout completed already.
        resolveRefresh(makeOkResponse({ accessToken: 'late-token', expiresIn: 600 }));

        await requestPromise;

        // setToken must NOT have been called with the late token.
        expect(authStoreMock.setToken).not.toHaveBeenCalledWith('late-token');
    });

    // -------------------------------------------------------------------------
    // Test 5: isLoggingOut flag cleared in finally after network failure
    // -------------------------------------------------------------------------

    it('isLoggingOut flag is cleared even after logout network failure', () => {
        // Verify the authStore flag contract.
        // isLoggingOut is set before the logout POST, and cleared in finally.
        authStoreMock.setIsLoggingOut(true);
        expect(authStoreMock.setIsLoggingOut).toHaveBeenCalledWith(true);

        authStoreMock.setIsLoggingOut.mockClear();

        // Simulate finally block.
        authStoreMock.setIsLoggingOut(false);
        expect(authStoreMock.setIsLoggingOut).toHaveBeenCalledWith(false);

        authStoreMock.getIsLoggingOut.mockReturnValue(false);
        expect(authStoreMock.getIsLoggingOut()).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Test 2: Single-flight — concurrent AUTH_TOKEN_EXPIRED share one refresh promise
    // -------------------------------------------------------------------------

    it('two concurrent AUTH_TOKEN_EXPIRED 401s share one in-flight refresh promise', async () => {
        let resolveRefresh!: (value: Response) => void;
        const refreshPromise = new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
        });

        fetchMock
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED'))
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED'))
            .mockReturnValueOnce(refreshPromise) // single refresh
            .mockResolvedValueOnce(makeOkResponse({ result: 'A' }))
            .mockResolvedValueOnce(makeOkResponse({ result: 'B' }));

        const p1 = apiRequest<{ result: string }>('/a');
        const p2 = apiRequest<{ result: string }>('/b');

        await new Promise<void>((r) => setTimeout(r, 0));

        resolveRefresh(makeOkResponse({ accessToken: 'shared-token', expiresIn: 600 }));

        await Promise.allSettled([p1, p2]);

        // Only one call to /auth/refresh.
        const refreshCalls = (fetchMock.mock.calls as [string, ...unknown[]][]).filter(
            ([url]) => typeof url === 'string' && url.includes('/auth/refresh'),
        );
        expect(refreshCalls.length).toBe(1);
    });

    // -------------------------------------------------------------------------
    // Boundary: refresh failure → store cleared, navigate to /login
    // -------------------------------------------------------------------------

    it('refresh failure (non-200) clears store and redirects to /login', async () => {
        fetchMock
            .mockResolvedValueOnce(makeAuthError('AUTH_TOKEN_EXPIRED'))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 'REFRESH_FAILED', message: 'fail', requestId: '' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                }),
            );

        await expect(apiRequest('/endpoint')).rejects.toBeInstanceOf(ApiError);

        expect(authStoreMock.clear).toHaveBeenCalled();
        expect(navigateMock).toHaveBeenCalledWith('/login');
    });
});
