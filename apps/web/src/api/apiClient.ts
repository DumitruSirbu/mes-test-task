import type { IApiErrorResponse, IAuthTokenResponse } from '@mes/shared';
import { XHR_REQUESTED_WITH, XHR_REQUESTED_WITH_HEADER, ApiErrorCodes } from '@mes/shared';
import { DEFAULT_API_BASE_URL } from '../const/WebUiConsts';
import { authStore } from '../auth/authStore';
import { navigate } from '../router/router';

/**
 * Tiny fetch wrapper used by every page. Centralises:
 *   - Base URL resolution from Vite env (`VITE_API_BASE_URL`).
 *   - `credentials: 'include'` and `X-Requested-With` header on every request (ADR 0007).
 *   - Bearer token injection from the auth store.
 *   - Canonical error envelope decoding into a typed `ApiError`.
 *   - Global 401 handling per ADR 0006 (amended by ADR 0007):
 *       - `AUTH_TOKEN_EXPIRED` → silent refresh + one retry.
 *       - Any other 401 code → drop token + redirect to /login, no retry.
 *   - Single-flight: concurrent 401s share one in-flight refresh promise.
 *   - Recursion bound: the retry path bypasses the 401 handler entirely.
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

export const getBaseUrl = (): string => {
    const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

    return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_API_BASE_URL;
};

export interface IApiRequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    token?: string | null;
    headers?: Record<string, string>;
}

// Single-flight refresh promise — shared across concurrent 401 handlers.
let inFlightRefresh: Promise<string> | null = null;

const dropTokenAndRedirect = (): void => {
    authStore.clear();
    navigate('/login');
};

const buildErrorBody = (status: number, parsed: unknown): IApiErrorResponse => {
    if (parsed && typeof parsed === 'object' && 'code' in parsed) {
        return parsed as IApiErrorResponse;
    }

    return {
        message: `Unexpected response from server (HTTP ${status})`,
        code: 'UNKNOWN_ERROR',
        requestId: '',
    };
};

const executeFetch = async (path: string, options: IApiRequestOptions): Promise<Response> => {
    const baseUrl = getBaseUrl();
    const headers: Record<string, string> = {
        Accept: 'application/json',
        [XHR_REQUESTED_WITH_HEADER]: XHR_REQUESTED_WITH,
        ...(options.headers ?? {}),
    };

    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }

    return fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        credentials: 'include',
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
};

const parseBody = async (response: Response): Promise<unknown> => {
    const text = await response.text();

    return text.length > 0 ? (JSON.parse(text) as unknown) : null;
};

/**
 * Executes a request WITHOUT the 401 interception layer.
 * Used for the single retry after a successful silent refresh, to guarantee no
 * recursive re-entry into the refresh path (ADR 0006 recursion bound).
 */
const executeRequestNoInterception = async <TResponse>(
    path: string,
    options: IApiRequestOptions,
): Promise<TResponse> => {
    const response = await executeFetch(path, options);
    const parsed = await parseBody(response);

    if (!response.ok) {
        if (response.status === 401) {
            // Any 401 on the retry drops the token and redirects — never re-enters refresh.
            dropTokenAndRedirect();
        }

        throw new ApiError(response.status, buildErrorBody(response.status, parsed));
    }

    return parsed as TResponse;
};

const attemptSilentRefresh = (): Promise<string> => {
    if (inFlightRefresh) return inFlightRefresh;

    const baseUrl = getBaseUrl();

    inFlightRefresh = fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            [XHR_REQUESTED_WITH_HEADER]: XHR_REQUESTED_WITH,
        },
    })
        .then(async (res) => {
            if (!res.ok) {
                dropTokenAndRedirect();
                throw new ApiError(res.status, {
                    message: 'Silent refresh failed',
                    code: 'REFRESH_FAILED',
                    requestId: '',
                });
            }

            const body = (await res.json()) as IAuthTokenResponse;

            // Guard: if logout completed while refresh was in flight, discard the result.
            if (authStore.getIsLoggingOut()) {
                throw new ApiError(401, {
                    message: 'Logout in progress',
                    code: 'LOGOUT_IN_PROGRESS',
                    requestId: '',
                });
            }

            authStore.setToken(body.accessToken);

            return body.accessToken;
        })
        .finally(() => {
            inFlightRefresh = null;
        });

    return inFlightRefresh;
};

export const apiRequest = async <TResponse>(path: string, options: IApiRequestOptions = {}): Promise<TResponse> => {
    const response = await executeFetch(path, options);
    const parsed = await parseBody(response);

    if (!response.ok) {
        const errorBody = buildErrorBody(response.status, parsed);

        if (response.status === 401) {
            if (errorBody.code !== ApiErrorCodes.AUTH_TOKEN_EXPIRED) {
                // Non-expiry 401 codes are not retryable — drop and redirect immediately.
                dropTokenAndRedirect();
                throw new ApiError(response.status, errorBody);
            }

            // AUTH_TOKEN_EXPIRED — attempt a single silent refresh.
            try {
                const newToken = await attemptSilentRefresh();

                // Guard: don't retry if logout completed while refresh was in flight.
                if (authStore.getIsLoggingOut()) {
                    throw new ApiError(401, {
                        message: 'Auth store cleared during refresh',
                        code: ApiErrorCodes.AUTH_TOKEN_EXPIRED,
                        requestId: '',
                    });
                }

                return executeRequestNoInterception<TResponse>(path, { ...options, token: newToken });
            } catch (refreshError) {
                if (refreshError instanceof ApiError) {
                    throw refreshError;
                }

                throw new ApiError(401, errorBody);
            }
        }

        throw new ApiError(response.status, errorBody);
    }

    return parsed as TResponse;
};
