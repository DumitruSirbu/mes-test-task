import { PipeTransform } from '@nestjs/common';
import { ZodSchema, ZodIssue } from 'zod';
import { ValidationFailedError } from '../error/ValidationFailedError';

/**
 * Generic pipe that validates and transforms an input value against a Zod schema.
 * On failure, throws `ValidationFailedError` (a DomainError) carrying per-field details
 * that match the canonical `VALIDATION_FAILED` envelope produced by `HttpExceptionFilter`.
 * Use via `@Query(new ZodValidationPipe(mySchema))` or `@UsePipes` at class level.
 */
export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
    public constructor(private readonly schema: ZodSchema<TOutput>) {}

    public transform(value: unknown): TOutput {
        const result = this.schema.safeParse(value);

        if (!result.success) {
            throw new ValidationFailedError(this.buildFields(result.error.issues));
        }

        return result.data;
    }

    private buildFields(issues: ZodIssue[]): Record<string, string[]> {
        const fields: Record<string, string[]> = {};

        for (const issue of issues) {
            const field = issue.path.join('.') || '_';
            fields[field] ??= [];
            fields[field].push(issue.message);
        }

        return fields;
    }
}
