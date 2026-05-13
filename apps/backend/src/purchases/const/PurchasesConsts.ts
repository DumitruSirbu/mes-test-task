/**
 * Purchases domain constants.
 *
 * `PURCHASE_ENDPOINT_SIGNATURE` is the value stored in `idempotency_keys.endpoint`
 * for the create-purchase route. Hard-coded (rather than derived from the request URL)
 * so a downstream URL re-route cannot accidentally split replay buckets.
 */
export const PURCHASE_ENDPOINT_SIGNATURE = 'POST /purchases';

/**
 * HTTP status persisted in `idempotency_keys.response_status` for a successful purchase
 * create. Kept here so the replay path mirrors the controller's `@HttpCode(201)` decision.
 */
export const PURCHASE_CREATED_STATUS = 201;
