import { createHash } from 'node:crypto';

/**
 * Produce a deterministic JSON serialisation of an arbitrary request body so that the
 * `request_hash` column compares equal across different key orderings or whitespace.
 *
 * This is a JCS-light implementation (RFC 8785 spirit): keys sorted alphabetically at
 * every object level, arrays preserved in order, primitives stringified via the JSON
 * grammar. Sufficient for the M04 purchase body (`{ courseId, studentEmail }`) and
 * any flat/nested JSON we expect to see on idempotent endpoints.
 */
export const canonicaliseBody = (body: unknown): string => {
    return JSON.stringify(sortKeysDeep(body));
};

export const hashCanonicalBody = (body: unknown): string => {
    return createHash('sha256').update(canonicaliseBody(body)).digest('hex');
};

const sortKeysDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }

    if (value !== null && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        const keys = Object.keys(source).sort();

        for (const key of keys) {
            sorted[key] = sortKeysDeep(source[key]);
        }

        return sorted;
    }

    return value;
};
