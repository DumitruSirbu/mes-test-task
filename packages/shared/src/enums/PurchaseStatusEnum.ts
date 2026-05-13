/**
 * Canonical purchase status vocabulary shared between backend and frontend.
 *
 * v1 DB ENUM `purchase_status` declares only `COMPLETED` — purchases are written
 * synchronously inside the request transaction (see ADR 0006 + data-model.md).
 * `PENDING` and `FAILED` are declared here so the v2 upgrade path (real PSP with
 * asynchronous state) doesn't require a shared-package change.
 */
export enum PurchaseStatusEnum {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}
