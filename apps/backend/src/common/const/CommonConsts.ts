/**
 * HTTP status codes as plain numbers — used wherever a `number` must be compared
 * against a status code without triggering the `no-unsafe-enum-comparison` lint rule
 * that fires when comparing `number` directly to a TypeScript numeric enum value.
 */
export const HTTP_STATUS_CONFLICT = 409;
export const HTTP_STATUS_GONE = 410;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

/**
 * Default PostgreSQL port. Used when POSTGRES_PORT env var is absent.
 */
export const POSTGRES_DEFAULT_PORT = 5432;

/**
 * Valid range for Express `trust proxy` integer setting.
 * 0 = no proxy, 1–3 = hop count to trust. Values outside [0, 3] indicate misconfiguration.
 */
export const TRUST_PROXY_MIN = 0;
export const TRUST_PROXY_MAX = 3;

/**
 * HTTP header used to propagate a request correlation ID from gateway / LB to the service
 * and echo it back on the response so clients can quote it in support tickets.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * CLS store key under which the resolved request ID is stored.
 * Every log line and error envelope reads from this key via ClsService.
 */
export const REQUEST_ID_KEY = 'requestId';

/**
 * Maximum byte length of an inbound `x-request-id` header value that will be accepted
 * and forwarded. Values exceeding this length are replaced with a fresh UUID to prevent
 * log-flooding attacks via very long header values.
 */
export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * Allowed character set for inbound request IDs: alphanumeric plus `.`, `_`, `-`.
 * The quantifier is bounded by REQUEST_ID_MAX_LENGTH (both must stay in sync).
 */
export const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Environment variable that holds the comma-separated CORS allow-list.
 * Read by both `main.ts` (CORS middleware) and `OriginAllowedGuard`.
 * Using the same constant avoids typo-induced divergence between the two readers.
 */
export const REFRESH_CSRF_ALLOWED_ORIGINS_ENV = 'CORS_ALLOWED_ORIGINS';

/**
 * Dev-mode fallback allow-list used when `CORS_ALLOWED_ORIGINS` is unset.
 * Never used in production (non-empty env var is required there).
 */
export const REFRESH_CSRF_ALLOWED_ORIGINS_FALLBACK: readonly string[] = [
    'http://localhost:5173',
    'http://localhost:5174',
];

/**
 * `NODE_ENV` value for production deployments.
 * Referenced by cookie helpers to gate the `Secure` attribute — never inline the
 * string `'production'` in business logic.
 */
export const NODE_ENV_PRODUCTION = 'production';
