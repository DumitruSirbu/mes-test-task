/**
 * Canonical invitation status vocabulary shared between backend and frontend.
 *
 * Mirrors the PostgreSQL native enum `invitation_status` (see data-model.md).
 * State transitions: `ISSUED → REDEEMED` (success) or `ISSUED → EXPIRED`
 * (lazy on read after `expires_at`).
 */
export enum InvitationStatusEnum {
    ISSUED = 'ISSUED',
    REDEEMED = 'REDEEMED',
    EXPIRED = 'EXPIRED',
}
