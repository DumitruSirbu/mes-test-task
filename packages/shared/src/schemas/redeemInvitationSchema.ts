import { z } from 'zod';

/**
 * `POST /invitations/:token/redeem` body validator.
 * Shared with the frontend so client-side validation matches the backend's
 * ValidationPipe contract exactly.
 *
 * - `token`: the invitation token (non-empty string).
 * - `firstName`, `lastName`: student full name, max 80 chars each, trimmed.
 *   Optional in the wire schema: omitted when an existing STUDENT account is being
 *   enrolled into a new course (the server ignores them and reuses the existing
 *   profile). Required when creating a new account — enforced server-side.
 * - `dateOfBirth`: ISO date string in YYYY-MM-DD format. Same optionality as above.
 * - `password`: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit.
 * - `strict()` rejects extra fields — defence in depth alongside `forbidNonWhitelisted`.
 */
export const redeemInvitationSchema = z
    .object({
        token: z.string().min(1),
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().min(1).max(80).optional(),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        password: z
            .string()
            .min(8)
            .regex(/[A-Z]/, 'password must contain at least one uppercase letter')
            .regex(/[a-z]/, 'password must contain at least one lowercase letter')
            .regex(/\d/, 'password must contain at least one digit'),
    })
    .strict();

export type RedeemInvitationDto = z.infer<typeof redeemInvitationSchema>;
