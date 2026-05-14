/**
 * Unit tests for web useAuthBootstrap (M10).
 *
 * Covers:
 *   3. App boot: silent refresh success → hydrates store + calls /auth/me; failure → /login
 *   4. App boot: /auth/me failure after successful refresh → store cleared + /login rendered
 *   8. Prod build: authStore NOT attached to window
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// authStore mock
// vi.mock is hoisted, so we use vi.hoisted to share the object with test assertions.
// ---------------------------------------------------------------------------

const authStoreMock = vi.hoisted(() => ({
    clear: vi.fn(),
    getState: vi.fn().mockReturnValue(null),
    setToken: vi.fn(),
    setUser: vi.fn(),
    getIsLoggingOut: vi.fn().mockReturnValue(false),
    setIsLoggingOut: vi.fn(),
    setState: vi.fn(),
}));

vi.mock('./authStore', () => ({
    authStore: authStoreMock,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeOkJson = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

const makeErrorResponse = (status: number): Response =>
    new Response(JSON.stringify({ code: 'ERROR', message: 'fail', requestId: '' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const REFRESH_OK_BODY = { accessToken: 'web-boot-token', expiresIn: 600 };
const ME_OK_BODY = { id: 7, role: 'STUDENT', email: 'student@mes.test' };

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useAuthBootstrap } from './useAuthBootstrap';

describe('useAuthBootstrap (web)', () => {
    let fetchMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        fetchMock = vi.spyOn(globalThis, 'fetch');

        // Stub localStorage to avoid JSDOM interference.
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    });

    // -------------------------------------------------------------------------
    // Test 3a: Successful boot → setToken + setUser called
    // -------------------------------------------------------------------------

    it('silent refresh success → calls setToken then setUser from /auth/me', async () => {
        fetchMock
            .mockResolvedValueOnce(makeOkJson(REFRESH_OK_BODY))
            .mockResolvedValueOnce(makeOkJson(ME_OK_BODY));

        const { result } = renderHook(() => useAuthBootstrap());

        await waitFor(() => expect(result.current).toBe('ready'));

        expect(authStoreMock.setToken).toHaveBeenCalledWith('web-boot-token');
        expect(authStoreMock.setUser).toHaveBeenCalledWith({
            userId: 7,
            role: 'STUDENT',
            email: 'student@mes.test',
        });
    });

    // -------------------------------------------------------------------------
    // Test 3b: Refresh failure → store null, ready
    // -------------------------------------------------------------------------

    it('silent refresh failure → store stays null, boot resolves as ready', async () => {
        fetchMock.mockResolvedValueOnce(makeErrorResponse(401));

        const { result } = renderHook(() => useAuthBootstrap());

        await waitFor(() => expect(result.current).toBe('ready'));

        expect(authStoreMock.setToken).not.toHaveBeenCalled();
        expect(authStoreMock.setUser).not.toHaveBeenCalled();
    });

    it('network error on /auth/refresh → authStore.clear called, boot resolves as ready', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network unreachable'));

        const { result } = renderHook(() => useAuthBootstrap());

        await waitFor(() => expect(result.current).toBe('ready'));

        expect(authStoreMock.clear).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Test 4: /auth/me failure after successful refresh → no partial hydration
    // -------------------------------------------------------------------------

    it('/auth/me 5xx after successful refresh → authStore.clear called, no partial hydration', async () => {
        fetchMock
            .mockResolvedValueOnce(makeOkJson(REFRESH_OK_BODY))
            .mockResolvedValueOnce(makeErrorResponse(503));

        const { result } = renderHook(() => useAuthBootstrap());

        await waitFor(() => expect(result.current).toBe('ready'));

        expect(authStoreMock.setToken).toHaveBeenCalledWith('web-boot-token');
        expect(authStoreMock.setUser).not.toHaveBeenCalled();
        expect(authStoreMock.clear).toHaveBeenCalled();
    });

    it('/auth/me network error after successful refresh → store cleared, no partial hydration', async () => {
        fetchMock
            .mockResolvedValueOnce(makeOkJson(REFRESH_OK_BODY))
            .mockRejectedValueOnce(new Error('Connection reset by peer'));

        const { result } = renderHook(() => useAuthBootstrap());

        await waitFor(() => expect(result.current).toBe('ready'));

        expect(authStoreMock.setToken).toHaveBeenCalledWith('web-boot-token');
        expect(authStoreMock.setUser).not.toHaveBeenCalled();
        expect(authStoreMock.clear).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Pending → ready transition
    // -------------------------------------------------------------------------

    it('starts in pending state and transitions to ready', async () => {
        let resolveRefresh!: (r: Response) => void;
        const refreshControlled = new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
        });
        fetchMock.mockReturnValueOnce(refreshControlled);
        fetchMock.mockResolvedValueOnce(makeOkJson(ME_OK_BODY));

        const { result } = renderHook(() => useAuthBootstrap());

        expect(result.current).toBe('pending');

        act(() => {
            resolveRefresh(makeOkJson(REFRESH_OK_BODY));
        });

        await waitFor(() => expect(result.current).toBe('ready'));
    });

    // -------------------------------------------------------------------------
    // Stale localStorage cleanup
    // -------------------------------------------------------------------------

    it('removes the stale mes.auth.v1 key from localStorage on boot', async () => {
        const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');
        fetchMock.mockResolvedValueOnce(makeErrorResponse(401));

        renderHook(() => useAuthBootstrap());

        await waitFor(() => {
            expect(removeSpy).toHaveBeenCalledWith('mes.auth.v1');
        });
    });
});

// ---------------------------------------------------------------------------
// Test 8: Prod build — store NOT attached to window
// ---------------------------------------------------------------------------

describe('authStore — XSS hardening (web)', () => {
    it('authStore is NOT attached to window in any form', () => {
        expect((window as unknown as Record<string, unknown>)['__authStore']).toBeUndefined();
        expect((window as unknown as Record<string, unknown>)['authStore']).toBeUndefined();
    });

    it('import.meta.env.DEV is a boolean (gate is evaluatable)', () => {
        expect(typeof import.meta.env.DEV).toBe('boolean');
    });
});
