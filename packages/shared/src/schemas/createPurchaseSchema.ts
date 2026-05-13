import { z } from 'zod';

/**
 * `POST /purchases` body validator. Shared with the frontend so the checkout form
 * validates identically to the backend's ValidationPipe.
 *
 * - `courseId` is a positive integer (FK to `courses.course_id`).
 * - `studentEmail` is the target — backend rejects redemption later if any existing
 *   user already owns this email (see data-model.md "Redeem flow").
 * - `strict()` rejects extra fields — defence in depth alongside `forbidNonWhitelisted`.
 */
export const createPurchaseSchema = z
    .object({
        courseId: z.number().int().positive(),
        studentEmail: z.string().trim().toLowerCase().email().max(255),
    })
    .strict();

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
