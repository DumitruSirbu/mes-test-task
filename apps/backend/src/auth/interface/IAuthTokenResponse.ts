/**
 * Shape returned by `POST /auth/login` and `POST /auth/signup`.
 * No refresh token in v1 per ADR 0003.
 */
export interface IAuthTokenResponse {
    accessToken: string;
    /** Seconds until the access token expires (mirrors JWT_EXPIRES_IN). */
    expiresIn: number;
}
