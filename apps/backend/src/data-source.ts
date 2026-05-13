import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from './users/entity/UserEntity';
import { ConfigurationError } from './common/error/ConfigurationError';

/**
 * Standalone TypeORM `DataSource` consumed by the CLI (`typeorm migration:run`,
 * `typeorm migration:generate`). The runtime application configures its own
 * connection inside `AppModule` via `TypeOrmModule.forRootAsync`, reusing the
 * shared `buildPostgresOptionsFromConfig` helper in `common/config/`.
 *
 * The CLI loads `.env` via dotenv before invocation (see backend package scripts).
 *
 * Any NODE_ENV that is not explicitly 'development' or 'test' is treated as production
 * so staging/preview environments cannot silently fall back to dev defaults.
 */
export const buildTypeOrmOptions = () => {
    const env = process.env.NODE_ENV ?? 'production';
    const isProd = env !== 'development' && env !== 'test';

    const required = (name: string, fallback: string): string => {
        const raw = process.env[name];
        // Treat whitespace-only values as absent so `VAR=""` is caught in production.
        const value = raw !== undefined ? raw.trim() : '';

        if (value !== '') {
            return value;
        }

        if (isProd) {
            throw new ConfigurationError(`Required env var ${name} is missing — refusing to build DataSource in production.`);
        }

        return fallback;
    };

    const portRaw = process.env.POSTGRES_PORT;
    const port = portRaw !== undefined && portRaw.trim() !== '' ? Number(portRaw) : 5432;

    return {
        type: 'postgres' as const,
        host: required('POSTGRES_HOST', 'localhost'),
        port,
        username: required('POSTGRES_USER', 'mes'),
        password: required('POSTGRES_PASSWORD', 'mes_dev_password'),
        database: required('POSTGRES_DB', 'mes'),
        entities: [UserEntity],
        migrations: [__dirname + '/migration/*.{ts,js}'],
        migrationsTableName: 'typeorm_migrations',
        migrationsTransactionMode: 'each' as const,
        synchronize: false,
        logging: process.env.TYPEORM_LOGGING === 'true',
    };
};

export default new DataSource(buildTypeOrmOptions());
