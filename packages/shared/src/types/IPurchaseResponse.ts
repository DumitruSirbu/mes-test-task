import { PurchaseStatusEnum } from '../enums/PurchaseStatusEnum.js';
import type { IInvitationResponse } from './IInvitationResponse.js';

/**
 * Projection of a `purchases` row returned by `POST /purchases` and `GET /me/purchases`.
 *
 * The `invitation` is embedded on the create response so the parent can immediately
 * see the URL. On the list endpoint (`GET /me/purchases`) the embedded invitation
 * carries `status` + `expiresAt` but its `url` field is the canonical redemption URL
 * stored at issue time — the plaintext token is the same value, only present because
 * we do not regenerate it (the token is the only credential).
 *
 * `createdAt` is ISO-8601 UTC.
 */
export interface IPurchaseResponse {
    id: number;
    courseId: number;
    status: PurchaseStatusEnum;
    amountPence: number;
    createdAt: string;
    invitation: IInvitationResponse;
}
