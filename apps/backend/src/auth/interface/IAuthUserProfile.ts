import type { UserRoleEnum } from '@mes/shared';

/**
 * `GET /auth/me` response — a small projection of the persisted user row.
 * Excludes `passwordHash` and anything else the SPA should never see.
 */
export interface IAuthUserProfile {
    id: number;
    email: string;
    role: UserRoleEnum;
    firstName: string | null;
    lastName: string | null;
}
