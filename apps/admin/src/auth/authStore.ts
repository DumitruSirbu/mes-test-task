import { useSyncExternalStore } from 'react';
import { UserRoleEnum } from '@mes/shared';

/**
 * Auth store for the admin SPA.
 *
 * Security model (M10):
 * - Access token is kept in a module-scoped variable (memory only). Never written to
 *   any Web Storage — XSS cannot exfiltrate it.
 * - User metadata (userId, email, role) is populated exclusively from the boot-time
 *   /auth/me call. No sessionStorage persistence — the httpOnly refresh cookie keeps
 *   the session alive across reloads.
 * - `isLoggingOut` guards against a race where an in-flight silent-refresh resolves
 *   after logout completes, which would otherwise resurrect the store.
 */

export interface IAuthState {
    accessToken: string;
    userId: number;
    role: UserRoleEnum;
    email: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();

let memoryToken: string | null = null;
let storedUser: Pick<IAuthState, 'userId' | 'role' | 'email'> | null = null;
let cachedState: IAuthState | null = null;
let isLoggingOut = false;

const rebuildState = (): void => {
    if (!memoryToken || !storedUser) {
        cachedState = null;
        return;
    }

    cachedState = {
        accessToken: memoryToken,
        userId: storedUser.userId,
        role: storedUser.role,
        email: storedUser.email,
    };
};

const emit = (): void => {
    for (const listener of listeners) {
        listener();
    }
};

export const authStore = {
    getState(): IAuthState | null {
        return cachedState;
    },

    setState(next: IAuthState): void {
        isLoggingOut = false;
        memoryToken = next.accessToken;
        storedUser = { userId: next.userId, role: next.role, email: next.email };
        rebuildState();
        emit();
    },

    setToken(token: string): void {
        memoryToken = token;
        rebuildState();
        emit();
    },

    setUser(user: Pick<IAuthState, 'userId' | 'role' | 'email'>): void {
        storedUser = user;
        rebuildState();
        emit();
    },

    clear(): void {
        memoryToken = null;
        storedUser = null;
        rebuildState();
        emit();
    },

    getIsLoggingOut(): boolean {
        return isLoggingOut;
    },

    setIsLoggingOut(value: boolean): void {
        isLoggingOut = value;
    },

    subscribe(listener: Listener): () => void {
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    },
};

export const useAuth = (): IAuthState | null => {
    return useSyncExternalStore(authStore.subscribe, authStore.getState, () => null);
};
