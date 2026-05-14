import { useEffect, useState } from 'react';
import type { IAuthenticatedUser } from '@mes/shared';
import { XHR_REQUESTED_WITH, XHR_REQUESTED_WITH_HEADER } from '@mes/shared';
import type { IAuthTokenResponse } from '@mes/shared';
import { getBaseUrl } from '../api/apiClient';
import { authStore } from './authStore';

type BootState = 'pending' | 'ready';

const STALE_SESSION_KEYS = ['mes.admin.user.v1', 'mes.admin.token.v1'] as const;

/**
 * Runs the silent-refresh + /auth/me boot sequence on app mount.
 *
 * Boot sequence (ADR 0007 §"App boot"):
 * 1. One-shot eviction of any stale sessionStorage keys from pre-M10 sessions.
 * 2. POST /auth/refresh — on failure, resolve as 'ready' (RequireAdmin redirects to /login).
 * 3. On success, store the new access token in memory.
 * 4. GET /auth/me — on any failure, clear the token + resolve as 'ready'.
 * 5. Populate the auth store with { userId, role, email }.
 *
 * Returns 'pending' until the dance completes so the app can show a loading state.
 */
export const useAuthBootstrap = (): BootState => {
    const [bootState, setBootState] = useState<BootState>('pending');

    useEffect(() => {
        // Evict any stale values left by pre-M10 sessions — idempotent.
        for (const key of STALE_SESSION_KEYS) {
            sessionStorage.removeItem(key);
        }

        const bootstrap = async (): Promise<void> => {
            const baseUrl = getBaseUrl();

            try {
                const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        [XHR_REQUESTED_WITH_HEADER]: XHR_REQUESTED_WITH,
                    },
                });

                if (!refreshRes.ok) {
                    // Cookie absent / expired / invalid — user must log in.
                    setBootState('ready');
                    return;
                }

                const refreshBody = (await refreshRes.json()) as IAuthTokenResponse;
                authStore.setToken(refreshBody.accessToken);

                try {
                    const meRes = await fetch(`${baseUrl}/auth/me`, {
                        credentials: 'include',
                        headers: {
                            Accept: 'application/json',
                            [XHR_REQUESTED_WITH_HEADER]: XHR_REQUESTED_WITH,
                            Authorization: `Bearer ${refreshBody.accessToken}`,
                        },
                    });

                    if (!meRes.ok) {
                        // /auth/me failure — no partial hydration.
                        authStore.clear();
                        setBootState('ready');
                        return;
                    }

                    // Widening: IAuthenticatedUser (shared) omits email by design; /auth/me returns it.
                    const profile = (await meRes.json()) as IAuthenticatedUser & { email: string };
                    authStore.setUser({
                        userId: profile.id,
                        role: profile.role,
                        email: profile.email,
                    });
                } catch {
                    // Network failure on /auth/me — clear and show login.
                    authStore.clear();
                }
            } catch {
                // Network failure on /auth/refresh — treat as unauthenticated.
                authStore.clear();
            }

            setBootState('ready');
        };

        void bootstrap();
    }, []);

    return bootState;
};
