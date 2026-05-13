import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import { REQUEST_ID_KEY } from '../const/CommonConsts';
import { PINO_REDACT_PATHS } from './LoggerConsts';

/**
 * Wraps `nestjs-pino` with the redaction list mandated by ADR 0005 and the request-id
 * correlation pulled from `nestjs-cls`. Imported by `AppModule`; downstream modules
 * inject `Logger` from `nestjs-pino` (not `@nestjs/common`).
 */
@Module({
    imports: [
        PinoLoggerModule.forRootAsync({
            inject: [ClsService],
            useFactory: (cls: ClsService) => {
                const isProd = process.env.NODE_ENV === 'production';
                const usePretty = !isProd && process.env.LOG_PRETTY !== 'false';
                return {
                    pinoHttp: {
                        autoLogging: {
                            ignore: (req: { url?: string }) => (req.url ?? '').startsWith('/health'),
                        },
                        level: process.env.LOG_LEVEL ?? 'info',
                        transport: usePretty
                            ? {
                                  target: 'pino-pretty',
                                  options: {
                                      singleLine: true,
                                      translateTime: 'SYS:HH:MM:ss.l',
                                      ignore: 'pid,hostname',
                                  },
                              }
                            : undefined,
                        redact: {
                            paths: PINO_REDACT_PATHS,
                            censor: '[REDACTED]',
                            remove: false,
                        },
                        customProps: () => {
                            const requestId = cls.get<string>(REQUEST_ID_KEY);
                            return requestId ? { requestId } : {};
                        },
                        serializers: {
                            req: (req: { id?: string; method?: string; url?: string }) => ({
                                method: req.method,
                                url: (req.url as string)?.replace(/^(\/invitations\/)([^/]+)(\/meta)/, '$1[REDACTED]$3'),
                                id: req.id,
                            }),
                        },
                    },
                };
            },
        }),
    ],
    exports: [PinoLoggerModule],
})
export class LoggerModule {}
