import { UserRoleEnum } from '../enums/UserRoleEnum.js';

/**
 * Projection of the user attached to `request.user` by `JwtAuthGuard` after a successful
 * token verification. Kept intentionally small — services that need email/profile fields
 * fetch a fresh row from the users repository.
 */
export interface IAuthenticatedUser {
    id: number;
    role: UserRoleEnum;
}
