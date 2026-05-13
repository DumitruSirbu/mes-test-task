import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigurationError } from './common/error/ConfigurationError';
import { TRUST_PROXY_MAX, TRUST_PROXY_MIN } from './common/const/CommonConsts';

/**
 * Bootstrap. Highlights:
 *   - Pino logger replaces Nest's default console logger (structured JSON in prod,
 *     pretty in dev). Logger is resolved after creation so `app.useLogger` sees the
 *     real provider instead of the buffer.
 *   - `trust proxy = 1` matches the single compose proxy hop (see auth-and-rbac.md
 *     "Trust-proxy configuration"). Direct-exposure deploys MUST adjust this.
 *   - CORS is bound to the comma-separated allow-list from `CORS_ORIGINS`.
 */
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));

    const trustProxyValue = Number(process.env.TRUST_PROXY ?? TRUST_PROXY_MIN);

    if (!Number.isFinite(trustProxyValue) || trustProxyValue < TRUST_PROXY_MIN || trustProxyValue > TRUST_PROXY_MAX) {
        throw new ConfigurationError(`TRUST_PROXY must be an integer in [${TRUST_PROXY_MIN}, ${TRUST_PROXY_MAX}], got: ${process.env.TRUST_PROXY}`);
    }

    app.set('trust proxy', trustProxyValue);

    const corsOrigins = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
    app.enableCors({
        origin: corsOrigins.length > 0 ? corsOrigins : false,
        credentials: false,
    });

    const port = Number(process.env.BACKEND_PORT ?? 3010);
    await app.listen(port);
}

void bootstrap();
