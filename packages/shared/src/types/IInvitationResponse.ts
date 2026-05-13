import { InvitationStatusEnum } from '../enums/InvitationStatusEnum.js';

/**
 * Projection of an `invitations` row returned alongside a purchase.
 *
 * `url` is the full redemption URL (origin + path + token query). The plaintext token
 * lives ONLY in this response — the DB stores SHA-256(token) in `token_hash`.
 *
 * `expiresAt` is an ISO-8601 UTC string (no `Date` types cross the wire).
 */
export interface IInvitationResponse {
    id: number;
    studentEmail: string;
    status: InvitationStatusEnum;
    expiresAt: string;
    url: string;
}
