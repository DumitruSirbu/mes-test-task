import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { UserRoleEnum } from '@mes/shared';
import type { IAuthenticatedUser, IPurchaseResponse } from '@mes/shared';
import { CurrentUser } from '../../auth/decorator/CurrentUser';
import { Roles } from '../../auth/decorator/Roles';
import { Idempotent } from '../../common/idempotency/decorator/Idempotent';
import { IdempotencyKeyRequiredError } from '../../common/error/IdempotencyKeyRequiredError';
import type { IIdempotencyContext } from '../../common/idempotency/interface/IIdempotencyContext';
import { CreatePurchaseDto } from '../dto/CreatePurchaseDto';
import { PurchasesService } from '../service/PurchasesService';

interface IRequestWithIdempotency {
    idempotencyContext?: IIdempotencyContext;
}

/**
 * Parent-only purchase surface.
 *
 * - `POST /purchases` requires the `Idempotency-Key` header; the global
 *   `IdempotencyInterceptor` validates it, performs the replay short-circuit on
 *   a hit, or attaches the canonical `IIdempotencyContext` to the request so the
 *   service can persist the response row inside its transaction.
 * - `GET /me/purchases` returns the parent's purchase history (newest first).
 *   The embedded invitation has no `url` (the plaintext token cannot be regenerated).
 */
@Controller()
@Roles(UserRoleEnum.PARENT)
export class PurchasesController {
    public constructor(private readonly purchasesService: PurchasesService) {}

    @Post('purchases')
    @Idempotent()
    @HttpCode(HttpStatus.CREATED)
    public async create(
        @CurrentUser() parent: IAuthenticatedUser,
        @Body() body: CreatePurchaseDto,
        @Req() request: IRequestWithIdempotency,
    ): Promise<IPurchaseResponse> {
        const idempotency = request.idempotencyContext;

        if (!idempotency) {
            // The interceptor stashes the context on every `@Idempotent()` route; reaching
            // here without it means the interceptor was never wired up.
            throw new IdempotencyKeyRequiredError('Idempotency context missing on request — interceptor not wired.');
        }

        return this.purchasesService.createPurchase({
            parentUserId: parent.id,
            body,
            idempotency: {
                key: idempotency.key,
                endpoint: idempotency.endpoint,
                requestHash: idempotency.requestHash,
            },
        });
    }

    @Get('me/purchases')
    public async listMine(@CurrentUser() parent: IAuthenticatedUser): Promise<IPurchaseResponse[]> {
        return this.purchasesService.listForParent(parent.id);
    }
}
