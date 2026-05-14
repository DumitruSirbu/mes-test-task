/**
 * Canonical API error codes emitted by the backend and branched on by the frontend.
 * Frontend code MUST import from this file instead of using inline string literals,
 * so changes to the wire format propagate atomically. See ADR 0005 for the full catalog.
 */
export const ApiErrorCodes = {
    /**
     * JWT access token has expired. 401 response from any authenticated endpoint.
     * Frontend branches on this code to attempt a silent token refresh (ADR 0006).
     */
    AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',

    /**
     * A student account with the invitation email already exists.
     * Returned by POST /invitations/:token/redeem when the email is already registered.
     */
    INVITATION_EMAIL_CONFLICT: 'INVITATION_EMAIL_CONFLICT',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];
