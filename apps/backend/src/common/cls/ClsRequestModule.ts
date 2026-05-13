import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER, REQUEST_ID_KEY, REQUEST_ID_REGEX } from '../const/CommonConsts';

/**
 * Per-request CLS context. Allocates a UUID `requestId` on every inbound HTTP request,
 * honouring an upstream `x-request-id` header when present so a gateway / LB can propagate
 * a trace id end-to-end. The same key is read by the pino logger module to stamp every
 * log line and by the HttpExceptionFilter to embed `requestId` in the error envelope.
 *
 * BullMQ processors set `requestId = \`job:<jobId>\`` via this same service in later milestones.
 */
@Module({
    imports: [
        ClsModule.forRoot({
            global: true,
            middleware: {
                mount: true,
                generateId: true,
                idGenerator: (req: Request): string => {
                    const incoming = req.headers[REQUEST_ID_HEADER];

                    if (typeof incoming === 'string' && REQUEST_ID_REGEX.test(incoming)) {
                        return incoming;
                    }

                    return randomUUID();
                },
                setup: (cls, req: Request) => {
                    cls.set(REQUEST_ID_KEY, cls.getId());
                    // Echo the resolved id back on the response so clients can quote it
                    const res = (req as Request & { res?: { setHeader: (k: string, v: string) => void } }).res;
                    res?.setHeader(REQUEST_ID_HEADER, cls.getId());
                },
            },
        }),
    ],
    exports: [ClsModule],
})
export class ClsRequestModule {}
