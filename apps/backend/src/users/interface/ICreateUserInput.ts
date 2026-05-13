import { UserRoleEnum } from '@mes/shared';

/**
 * Typed input for inserting a new user row.
 * Keeps `insertUser` from accepting arbitrary partial shapes of `UserEntity`.
 */
export interface ICreateUserInput {
    email: string;
    passwordHash: string;
    role: UserRoleEnum;
    firstName?: string | null;
    lastName?: string | null;
}
