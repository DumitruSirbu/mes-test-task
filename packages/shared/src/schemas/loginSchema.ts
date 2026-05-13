import { z } from 'zod';

/**
 * Login request validator. Shared with the frontend so client-side validation matches
 * the backend's ValidationPipe contract exactly.
 */
export const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
