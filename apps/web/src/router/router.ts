import { useSyncExternalStore } from 'react';

/**
 * Minimal hash-based router. URL fragment shape: `#/courses`, `#/courses/:id`, etc.
 *
 * Using the fragment keeps the SPA portable across hosts without server URL rewrites
 * and avoids pulling in a third-party router for the four pages this milestone needs.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

const readPath = (): string => {
    const raw = window.location.hash.replace(/^#/, '');

    return raw.length === 0 ? '/' : raw;
};

let currentPath = readPath();

const handleHashChange = (): void => {
    currentPath = readPath();

    for (const listener of listeners) {
        listener();
    }
};

window.addEventListener('hashchange', handleHashChange);

export const navigate = (path: string): void => {
    if (window.location.hash === `#${path}`) {
        // Force a refresh-style notification even if the path is the same.
        handleHashChange();

        return;
    }

    window.location.hash = path;
};

export const useRoutePath = (): string => {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        () => currentPath,
        () => '/',
    );
};

export interface IMatchResult {
    params: Record<string, string>;
}

export const matchRoute = (pattern: string, path: string): IMatchResult | null => {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) {
        return null;
    }

    const params: Record<string, string> = {};

    for (let index = 0; index < patternParts.length; index++) {
        const patternPart = patternParts[index];
        const pathPart = pathParts[index];

        if (patternPart.startsWith(':')) {
            params[patternPart.slice(1)] = decodeURIComponent(pathPart);
            continue;
        }

        if (patternPart !== pathPart) {
            return null;
        }
    }

    return { params };
};
