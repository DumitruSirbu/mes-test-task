import type { InvitationStatusEnum } from '../enums/InvitationStatusEnum.js';

/**
 * Response for `GET /invitations/:token/meta`.
 * Allows a student to preview invitation details before redemption.
 *
 * `expiresAt` is an ISO-8601 UTC string (no `Date` types cross the wire).
 * `status` lets the frontend skip the form and show a contextual message for
 * already-redeemed or expired invitations.
 */
export interface IInvitationMetaResponse {
    courseTitle: string;
    parentEmail: string;
    studentEmail: string;
    expiresAt: string;
    status: InvitationStatusEnum;
}
