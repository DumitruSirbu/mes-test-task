import { UserRoleEnum } from '../enums/UserRoleEnum.js';

/**
 * JWT payload shape. Carries only the minimum needed to enforce RBAC without a DB lookup.
 * No PII — see ADR 0003.
 */
export interface IJwtPayload {
    sub: number; // users.user_id
    role: UserRoleEnum;
    iat: number; // issued-at (seconds since epoch)
    exp: number; // expiry (seconds since epoch)
}
