import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by `JwtAuthGuard`. Routes marked `@Public()` skip authentication
 * entirely. The ONLY legitimate way to expose an unauthenticated endpoint — anything
 * else means the global guard is missing.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
