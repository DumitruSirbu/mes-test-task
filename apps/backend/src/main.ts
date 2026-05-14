import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigurationError } from './common/error/ConfigurationError';
import { TRUST_PROXY_MAX, TRUST_PROXY_MIN, REFRESH_CSRF_ALLOWED_ORIGINS_ENV, REFRESH_CSRF_ALLOWED_ORIGINS_FALLBACK } from './common/const/CommonConsts';

/**
 * Bootstrap. Highlights:
 *   - Pino logger replaces Nest's default console logger (structured JSON in prod,
 *     pretty in dev). Logger is resolved after creation so `app.useLogger` sees the
 *     real provider instead of the buffer.
 *   - `trust proxy = 1` matches the single compose proxy hop (see auth-and-rbac.md
 *     "Trust-proxy configuration"). Direct-exposure deploys MUST adjust this.
 *   - CORS uses the function form to echo the matched origin and enable `credentials: true`
 *     (ADR 0007 §9). `Access-Control-Allow-Origin: *` is never combined with credentials —
 *     browsers reject it. The allow-list is read from `CORS_ALLOWED_ORIGINS` env var.
 *   - `cookie-parser` middleware is mounted so `request.cookies` is populated for the
 *     `/auth/refresh` and `/auth/logout` endpoints. NestJS's Express adapter does not
 *     auto-populate `req.cookies` without this middleware.
 */
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));

    // Triggers `OnModuleDestroy` on all providers (including BullMQ workers) when the
    // process receives SIGTERM or SIGINT. This lets in-flight jobs drain before shutdown.
    // See async-jobs.md "Graceful shutdown" and ADR 0006.
    app.enableShutdownHooks();

    const trustProxyValue = Number(process.env.TRUST_PROXY ?? TRUST_PROXY_MIN);

    if (!Number.isFinite(trustProxyValue) || trustProxyValue < TRUST_PROXY_MIN || trustProxyValue > TRUST_PROXY_MAX) {
        throw new ConfigurationError(`TRUST_PROXY must be an integer in [${TRUST_PROXY_MIN}, ${TRUST_PROXY_MAX}], got: ${process.env.TRUST_PROXY}`);
    }

    app.set('trust proxy', trustProxyValue);

    // Disable Express's default weak-ETag on JSON responses. Stable empty-list ETags caused
    // browsers to replay 304s on /admin/* listing endpoints, surfacing as empty UI on reload.
    // TanStack Query owns client-side caching; HTTP-cache validation adds no value here.
    app.set('etag', false);

    // cookie-parser is required so req.cookies is populated by Express.
    // NestJS's platform-express does NOT auto-populate req.cookies without it.
    app.use(cookieParser());

    const corsOrigins = (process.env[REFRESH_CSRF_ALLOWED_ORIGINS_ENV] ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

    const allowedSet = new Set<string>(corsOrigins.length > 0 ? corsOrigins : REFRESH_CSRF_ALLOWED_ORIGINS_FALLBACK);

    app.enableCors({
        // Function form: echo the matched origin so credentials are accepted by browsers.
        // Returning `false` for unmatched origins causes the browser to block the response.
        // ADR 0007 §9: absent Origin is never implicitly allowed — browsers always
        // send Origin on credentialed cross-origin requests from the SPA. A missing
        // Origin header means the request is not a browser-initiated cross-origin
        // fetch (e.g. server-side curl) and must be denied by CORS policy.
        origin: (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            if (requestOrigin && allowedSet.has(requestOrigin)) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        },
        credentials: true,
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
    });

    const port = Number(process.env.BACKEND_PORT ?? 3010);
    await app.listen(port);
}

void bootstrap();
