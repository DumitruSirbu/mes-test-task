import { UserRoleEnum } from '@mes/shared';

interface JwtPayload {
    sub: number;
    role: UserRoleEnum;
}

export const decodeJwtPayload = (token: string): JwtPayload => {
    const segment = token.split('.')[1];
    const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);

    return JSON.parse(atob(padded)) as JwtPayload;
};
