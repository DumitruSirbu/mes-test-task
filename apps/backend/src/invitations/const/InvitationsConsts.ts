/**
 * Invitation domain constants.
 *
 * - TOKEN_BYTE_LENGTH = 32 → 256 bits of entropy, base64url-encoded ⇒ 43-char URL-safe string.
 * - INVITATION_EXPIRY_DAYS = 14 (see data-model.md `invitations.expires_at`).
 * - INVITATION_TOKEN_HASH_ALGORITHM is the digest algorithm used for `token_hash`. SHA-256
 *   is the documented choice — a DB dump exposes only hashes, never live tokens.
 * - INVITATION_TOKEN_QUERY_PARAM is the URL search-parameter name used by the redeem page.
 */
export const TOKEN_BYTE_LENGTH = 32;
export const INVITATION_EXPIRY_DAYS = 14;
export const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
export const INVITATION_TOKEN_HASH_ALGORITHM = 'sha256';
export const INVITATION_TOKEN_QUERY_PARAM = 'token';
export const DEFAULT_INVITATION_BASE_URL = 'http://localhost:5173/invitations/redeem';
