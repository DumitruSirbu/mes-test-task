/**
 * Invitation domain constants.
 *
 * - TOKEN_BYTE_LENGTH = 32 → 256 bits of entropy, base64url-encoded ⇒ 43-char URL-safe string.
 * - INVITATION_EXPIRY_DAYS = 14 (see data-model.md `invitations.expires_at`).
 * - INVITATION_TOKEN_HASH_ALGORITHM is the digest algorithm used for `token_hash`. SHA-256
 *   is the documented choice — a DB dump exposes only hashes, never live tokens.
 * - DEFAULT_INVITATION_BASE_URL matches the frontend hash-router route `/onboard/:token`.
 *   The token is appended as a path segment, not a query param, so the URL reads
 *   `http://localhost:5173/#/onboard/<token>` and the router resolves it via matchRoute.
 */
export const TOKEN_BYTE_LENGTH = 32;
export const INVITATION_EXPIRY_DAYS = 14;
export const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
export const INVITATION_TOKEN_HASH_ALGORITHM = 'sha256';
export const DEFAULT_INVITATION_BASE_URL = 'http://localhost:5173/#/onboard';
