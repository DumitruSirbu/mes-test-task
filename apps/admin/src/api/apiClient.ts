import type { IApiErrorResponse } from '@mes/shared';
import { DEFAULT_API_BASE_URL, ERROR_PREVIEW_MAX_LENGTH } from '../const/AdminUiConsts';
import { authStore } from '../auth/authStore';

/**
 * Fetch wrapper for the admin SPA. Centralises base URL resolution, Bearer token
 * injection, canonical error-envelope decoding, and global 401 handling.
 */

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
}

export const apiRequest = async <TResponse>(path: string, options: IApiRequestOptions = {}): Promise<TResponse> => {
    const baseUrl = getBaseUrl();
    const headers: Record<string, string> = {
        Accept: 'application/json',
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

    if (!response.ok) {
        let errorBody: IApiErrorResponse;

        try {
            errorBody = JSON.parse(text) as IApiErrorResponse;
        } catch {
            errorBody = {
                message: `Unexpected response from server (HTTP ${response.status})`,
                code: 'UNKNOWN_ERROR',
                requestId: '',
                details: { raw: text.slice(0, ERROR_PREVIEW_MAX_LENGTH) },
            };
        }

        if (response.status === 401) {
            authStore.clear();
        }

        throw new ApiError(response.status, errorBody);
    }

    let parsed: unknown = null;

    try {
        parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch {
        throw new ApiError(response.status, {
            message: 'Failed to parse server response',
            code: 'PARSE_ERROR',
            requestId: '',
            details: { raw: text.slice(0, ERROR_PREVIEW_MAX_LENGTH) },
        });
    }

    // Trust boundary: JSON.parse returns `unknown`; the API contract guarantees the shape matches TResponse.
    return parsed as TResponse;
};
