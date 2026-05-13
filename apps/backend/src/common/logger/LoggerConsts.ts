/**
 * Pino redaction path list — every path listed here is replaced with `[REDACTED]` in
 * structured log output. Centralised here so additions are reviewed in one place.
 *
 * Rule: any field that carries a secret, credential, or PII that must not appear in logs
 * or log-aggregation platforms must be added to this list.
 */
export const PINO_REDACT_PATHS: string[] = [
    'password',
    '*.password',
    'req.body.password',
    'passwordHash',
    '*.passwordHash',
    'req.body.passwordHash',
    'password_hash',
    'secret',
    'apiKey',
    'token',
    '*.token',
    'accessToken',
    '*.accessToken',
    'refreshToken',
    '*.refreshToken',
    'jwt',
    'invitationToken',
    'invitationUrl',
    '*.invitationUrl',
    '*.recipientEmail',
    'req.headers.authorization',
    'req.headers.cookie',
    'set-cookie',
];
