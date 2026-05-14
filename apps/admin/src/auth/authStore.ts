import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { UserRoleEnum } from '@mes/shared';
import { AUTH_SESSION_STORAGE_KEY } from '../const/AdminUiConsts';

/**
 * Auth store for the admin SPA.
 *
 * Security model:
 * - Access token is kept in a module-scoped variable (memory only). It is never
 *   written to any Web Storage, so XSS cannot exfiltrate it via localStorage/sessionStorage.
 * - User metadata (id, email, role) is persisted to sessionStorage so the UI
 *   can show the logged-in user across navigations within the same tab. It is
 *   cleared automatically when the tab is closed.
 * - On a full page reload the token is gone, so RequireAdmin redirects to /login.
 */

export interface IAuthState {
    accessToken: string;
    userId: number;
    role: UserRoleEnum;
    email: string;
}

type StoredUser = Pick<IAuthState, 'userId' | 'role' | 'email'>;

const storedUserSchema = z.object({
    userId: z.number().int().positive(),
    role: z.nativeEnum(UserRoleEnum),
    email: z.string().email(),
});

type Listener = () => void;

const listeners = new Set<Listener>();

// Access token lives only in memory — never persisted.
let memoryToken: string | null = null;

const loadStoredUser = (): StoredUser | null => {
    try {
        const raw = sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
        if (!raw) return null;

        const result = storedUserSchema.safeParse(JSON.parse(raw));
        if (!result.success) {
            sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
            return null;
        }

        return result.data;
    } catch {
        sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
        return null;
    }
};

let storedUser: StoredUser | null = loadStoredUser();
let cachedState: IAuthState | null = null;

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
        memoryToken = next.accessToken;
        storedUser = { userId: next.userId, role: next.role, email: next.email };
        sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(storedUser));
        rebuildState();
        emit();
    },

    clear(): void {
        memoryToken = null;
        storedUser = null;
        sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
        rebuildState();
        emit();
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
