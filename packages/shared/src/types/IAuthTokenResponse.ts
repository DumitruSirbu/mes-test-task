/**
 * Authentication token response shape. Returned by login and signup endpoints.
 */
export interface IAuthTokenResponse {
    accessToken: string;
    expiresIn: number;
}
