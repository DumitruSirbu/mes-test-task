import { useSyncExternalStore } from 'react';
import { UserRoleEnum } from '@mes/shared';

/**
 * Tiny auth store backed by `localStorage`. Persists the access token + minimal profile
 * (id, role) so route guards can decide without an extra `/auth/me` round-trip on load.
 *
 * The store is intentionally minimal — TanStack Query / Zustand are out of scope for
 * this milestone's "minimal viable parent journey". Upgrade paths are documented in
 * docs/architecture/overview.md.
 */

const STORAGE_KEY = 'mes.auth.v1';

export interface IAuthState {
    accessToken: string;
    userId: number;
    role: UserRoleEnum;
    email: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();

const loadInitial = (): IAuthState | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return null;
        }

        return JSON.parse(raw) as IAuthState;
    } catch {
        return null;
    }
};

let state: IAuthState | null = loadInitial();

const emit = (): void => {
    for (const listener of listeners) {
        listener();
    }
};

export const authStore = {
    getState(): IAuthState | null {
        return state;
    },

    setState(next: IAuthState): void {
        state = next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        emit();
    },

    clear(): void {
        state = null;
        localStorage.removeItem(STORAGE_KEY);
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
