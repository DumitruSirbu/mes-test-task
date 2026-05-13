/**
 * Canonical JSON error envelope returned by every backend endpoint on a non-2xx response.
 * Frontend branches on `code`, never on `message`. See ADR 0005 for the full code catalog.
 */
export interface IApiErrorResponse {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
}
