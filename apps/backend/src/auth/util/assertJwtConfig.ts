import { ConfigurationError } from '../../common/error/ConfigurationError';
import { JWT_EXPIRES_IN_REGEX, JWT_SECRET_MIN_LENGTH } from '../const/AuthConsts';

/**
 * Validates JWT_SECRET length and JWT_EXPIRES_IN format at boot.
 * Called once in `AuthModule.useFactory` and once in `JwtStrategy` constructor.
 *
 * Throws `ConfigurationError` on any violation so the process refuses to start with
 * misconfigured auth settings. The check is intentionally centralised here so both
 * consumers stay in sync.
 */
export function assertJwtConfig(secret: string | undefined, expiresIn: string): void {
    if (!secret || secret.length < JWT_SECRET_MIN_LENGTH) {
        throw new ConfigurationError(`JWT_SECRET is missing or shorter than ${JWT_SECRET_MIN_LENGTH} characters — refusing to boot.`);
    }

    if (!JWT_EXPIRES_IN_REGEX.test(expiresIn)) {
        throw new ConfigurationError(`JWT_EXPIRES_IN value "${expiresIn}" is invalid — expected a positive integer followed by s, m, h, or d (e.g. "15m").`);
    }
}
