import type { IApiErrorResponse } from '@mes/shared';

/**
 * Tiny fetch wrapper used by every page. Centralises:
 *   - Base URL resolution from Vite env (`VITE_API_BASE_URL`).
 *   - Bearer token injection from the auth store.
 *   - Canonical error envelope decoding into a typed `ApiError`.
 *
 * No retries here — per ADR 0006 mutation retries are disabled by default and the
 * idempotency layer makes server-side retries unnecessary anyway.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:3010';

export class ApiError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly requestId: string;
    public readonly details?: Record<string, unknown>;

    public constructor(status: number, body: IApiErrorResponse) {
        super(body.message);
        this.name = 'ApiError';
        this.status = status;
        this.code = body.code;
        this.requestId = body.requestId;
        this.details = body.details;
    }
}

const getBaseUrl = (): string => {
    const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

    return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_API_BASE_URL;
};

export interface IApiRequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    token?: string | null;
    headers?: Record<string, string>;
}

export const apiRequest = async <TResponse>(path: string, options: IApiRequestOptions = {}): Promise<TResponse> => {
    const baseUrl = getBaseUrl();
    const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(options.headers ?? {}),
    };

    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
        throw new ApiError(response.status, parsed as IApiErrorResponse);
    }

    return parsed as TResponse;
};
