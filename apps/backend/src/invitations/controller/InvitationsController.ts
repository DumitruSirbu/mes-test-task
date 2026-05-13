import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { IAuthTokenResponse, IInvitationMetaResponse } from '@mes/shared';
import { Public } from '../../auth/decorator/Public';
import { InvitationsService } from '../service/InvitationsService';
import { RedeemInvitationDto } from '../dto/RedeemInvitationDto';

/**
 * `/invitations/*` — all routes are public (unauthenticated).
 *
 * - `POST /invitations/redeem`: validates the token, creates the student account and
 *   enrolment atomically in a single transaction, and returns a JWT so the student
 *   lands in the LMS without a separate login step.
 *
 * - `GET /invitations/:token/meta`: returns course + parent + expiry preview for the
 *   redemption page UI (no auth required; oracle-resistance is provided by the 410
 *   shape on all error paths).
 */
@Controller('invitations')
export class InvitationsController {
    public constructor(private readonly invitationsService: InvitationsService) {}

    @Public()
    @Post('redeem')
    @HttpCode(HttpStatus.OK)
    public async redeem(@Body() body: RedeemInvitationDto): Promise<IAuthTokenResponse> {
        return this.invitationsService.redeem(body);
    }

    @Public()
    @Get(':token/meta')
    @HttpCode(HttpStatus.OK)
    public async getMeta(@Param('token') token: string): Promise<IInvitationMetaResponse> {
        return this.invitationsService.getMetaByToken(token);
    }
}
