/**
 * Generate a UUID v4 — used as the `Idempotency-Key` for the purchase mutation.
 *
 * `crypto.randomUUID` is available in every browser that ships ES2023 (the project
 * baseline). The fallback path keeps the helper testable in JSDOM environments
 * where `crypto.randomUUID` may be absent.
 */
export const generateUuid = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    // Fallback: 16-byte buffer hex-encoded into UUID v4 layout.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
