/**
 * Canonical role vocabulary shared between backend (DB + guards) and frontend (route gating).
 *
 * Mirrors the PostgreSQL native enum `user_role` (see docs/architecture/data-model.md).
 * Values are case-sensitive and MUST match the DB declaration exactly.
 */
export enum UserRoleEnum {
    PARENT = 'PARENT',
    STUDENT = 'STUDENT',
    ADMIN = 'ADMIN',
}
