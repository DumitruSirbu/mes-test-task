import { z } from 'zod';

/**
 * Parent self-signup validator.
 *
 * - Password policy: 12–128 chars, at least one letter and one digit (OWASP-ish floor;
 *   max length is a DoS guard against megabyte-sized argon2 inputs — see auth-and-rbac.md).
 * - The role is NEVER accepted from the client — `POST /auth/signup` is a parent-only
 *   public endpoint. Admin users are seeded via migration; students arrive via invitation.
 *   `strict()` rejects any extra fields (defence-in-depth alongside ValidationPipe's
 *   `forbidNonWhitelisted: true`).
 */
export const signupSchema = z
    .object({
        email: z.string().trim().toLowerCase().email().max(255),
        password: z
            .string()
            .min(12, 'Password must be at least 12 characters')
            .max(128, 'Password must be at most 128 characters')
            .regex(/[A-Za-z]/, 'Password must contain at least one letter')
            .regex(/[0-9]/, 'Password must contain at least one digit'),
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().min(1).max(80).optional(),
    })
    .strict();

export type SignupInput = z.infer<typeof signupSchema>;
