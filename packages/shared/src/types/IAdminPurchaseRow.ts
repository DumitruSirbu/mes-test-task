import { PurchaseStatusEnum } from '../enums/PurchaseStatusEnum.js';

/**
 * Wire-format shape for a single purchase row returned by the admin API.
 * Dates are ISO strings as serialised by the HTTP layer.
 */
export interface IAdminPurchaseRow {
    id: number;
    parentId: number;
    courseId: number;
    status: PurchaseStatusEnum;
    amountPence: number;
    createdAt: string;
}
