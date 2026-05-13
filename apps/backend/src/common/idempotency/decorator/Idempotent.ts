import { SetMetadata } from '@nestjs/common';

/**
 * Marks a handler as participating in the idempotency protocol. The global
 * `IdempotencyInterceptor` reads this metadata to know whether to short-circuit
 * on replay. Handlers WITHOUT this decorator pass through untouched.
 *
 * Pair with `@Roles(...)` and (for purchases) `@Post(...)` — order of decorators
 * does not matter for metadata-only setters.
 */
export const IDEMPOTENT_KEY = 'isIdempotent';
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);
