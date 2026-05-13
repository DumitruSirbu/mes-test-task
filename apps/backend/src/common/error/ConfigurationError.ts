import { DomainError } from './DomainError';

/**
 * Thrown at application boot when a required configuration value is missing or invalid.
 * Results in a non-zero process exit rather than a 500 response — the global filter never
 * sees it during normal operation; it fires before the HTTP layer is ready.
 */
export class ConfigurationError extends DomainError {
    public constructor(message: string) {
        super({
            httpStatus: 500,
            code: 'CONFIGURATION_ERROR',
            message,
        });
    }
}
