import { DomainError } from './DomainError';
import { HTTP_STATUS_GONE } from '../const/CommonConsts';

export class PurchaseNotFoundError extends DomainError {
    public constructor(cause?: unknown) {
        super({
            httpStatus: HTTP_STATUS_GONE,
            code: 'PURCHASE_NOT_FOUND',
            message: 'The associated purchase could not be found.',
            cause,
        });
    }
}
