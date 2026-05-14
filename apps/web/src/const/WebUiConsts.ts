export const DEFAULT_API_BASE_URL = 'http://localhost:3010';
export const LOGOUT_TIMEOUT_MS = 3_000;

/** sessionStorage key for the last completed purchase — shared between CheckoutPage and CheckoutSuccessPage. */
export const LAST_PURCHASE_STORAGE_KEY = 'mes.lastPurchase.v1';

/** Historical localStorage keys written by pre-M10 sessions; evicted on boot to clean up stale values. */
export const STALE_STORAGE_KEYS = ['mes.auth.v1'] as const;
