import { describe, it, expect } from 'vitest';
import { UserRoleEnum } from '@mes/shared';
import { decodeJwtPayload } from './decodeJwtPayload';

/**
 * `decodeJwtPayload` reads the second segment of a JWT (the payload) and returns
 * the decoded `{ sub, role }` pair. It performs NO signature verification — the
 * caller trusts the server issued the token.
 */

function buildJwt(payload: object): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signature = 'fakesignature';

    return `${header}.${body}.${signature}`;
}

describe('decodeJwtPayload', () => {
    it('returns sub and role from a valid JWT payload', () => {
        const token = buildJwt({ sub: 42, role: UserRoleEnum.PARENT, iat: 1000, exp: 2000 });

        const result = decodeJwtPayload(token);

        expect(result.sub).toBe(42);
        expect(result.role).toBe(UserRoleEnum.PARENT);
    });

    it('returns STUDENT role when payload carries STUDENT', () => {
        const token = buildJwt({ sub: 7, role: UserRoleEnum.STUDENT });

        const result = decodeJwtPayload(token);

        expect(result.sub).toBe(7);
        expect(result.role).toBe(UserRoleEnum.STUDENT);
    });

    it('handles base64url-encoded payload (+ and / replaced with - and _)', () => {
        // A payload that, when base64-encoded, contains characters that need url-encoding.
        // The function must normalise them back before calling atob.
        const payload = { sub: 123, role: UserRoleEnum.PARENT };
        const token = buildJwt(payload);

        // Should not throw.
        const result = decodeJwtPayload(token);

        expect(result.sub).toBe(123);
    });

    it('throws when the token string has fewer than 3 segments', () => {
        const malformed = 'onlyone';

        // `atob` will receive an empty string (segment[1] is undefined → TypeError or atob error).
        expect(() => decodeJwtPayload(malformed)).toThrow();
    });

    it('throws when the payload segment is not valid base64', () => {
        const invalidBase64 = 'header.!!!invalid!!!.signature';

        expect(() => decodeJwtPayload(invalidBase64)).toThrow();
    });
});
