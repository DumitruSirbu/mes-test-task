import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigurationError } from '../error/ConfigurationError';
import { POSTGRES_DEFAULT_PORT } from '../const/CommonConsts';

/**
 * Resolves PostgreSQL connection options from environment variables.
 *
 * Used by both the runtime `AppModule` (via `ConfigService`) and the CLI `DataSource`
 * (via raw `process.env`). This single source of truth keeps the two in sync — see
 * `data-source.ts` and ADR 0004.
 *
 * Required vars in non-development/test environments: POSTGRES_HOST, POSTGRES_USER,
 * POSTGRES_PASSWORD, POSTGRES_DB. Missing values in production throw `ConfigurationError`
 * rather than silently falling back to dev defaults.
 */

export interface IPostgresOptions {
    type: 'postgres';
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    synchronize: false;
    logging: boolean;
}

/**
 * Build Postgres options from `ConfigService` (used in `AppModule.forRootAsync`).
 *
 * Throws `ConfigurationError` when a required env var is absent in production.
 */
export function buildPostgresOptionsFromConfig(config: ConfigService): IPostgresOptions & Pick<TypeOrmModuleOptions, 'autoLoadEntities'> {
    const env = config.get<string>('NODE_ENV') ?? 'production';
    const isProd = env !== 'development' && env !== 'test';

    const required = (name: string, fallback: string): string => {
        const raw = config.get<string>(name);
        const value = raw !== undefined ? raw.trim() : '';

        if (value !== '') {
            return value;
        }

        if (isProd) {
            throw new ConfigurationError(`Required env var ${name} is missing — refusing to start in production.`);
        }

        return fallback;
    };

    const portRaw = config.get<string>('POSTGRES_PORT');
    const port = portRaw !== undefined && portRaw.trim() !== '' ? Number(portRaw) : POSTGRES_DEFAULT_PORT;

    return {
        type: 'postgres',
        host: required('POSTGRES_HOST', 'localhost'),
        port,
        username: required('POSTGRES_USER', 'mes'),
        password: required('POSTGRES_PASSWORD', 'mes_dev_password'),
        database: required('POSTGRES_DB', 'mes'),
        synchronize: false,
        autoLoadEntities: false,
        logging: config.get<string>('TYPEORM_LOGGING') === 'true',
    };
}
