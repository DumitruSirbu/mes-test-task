import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { InvitationStatusEnum } from '@mes/shared';
import type { IInvitationResponse } from '@mes/shared';
import { InvitationEntity } from '../entity/InvitationEntity';
import { InvitationsRepository } from '../repository/InvitationsRepository';
import {
    DEFAULT_INVITATION_BASE_URL,
    INVITATION_EXPIRY_DAYS,
    INVITATION_TOKEN_HASH_ALGORITHM,
    INVITATION_TOKEN_QUERY_PARAM,
    MILLIS_PER_DAY,
    TOKEN_BYTE_LENGTH,
} from '../const/InvitationsConsts';

/**
 * Owns invitation issuance + lookup. Redemption (the `ISSUED → REDEEMED` transition) lands
 * in M05; this service exposes the seam (`markRedeemed`) so the consuming module never
 * reaches into the repository directly.
 *
 * Token contract:
 *   - 32 bytes from `crypto.randomBytes` → ≥ 256 bits entropy.
 *   - base64url-encoded (URL-safe, no padding).
 *   - DB stores SHA-256(token) in `token_hash`. Lookups SHA-256 the incoming token and
 *     query by hash — constant-time at the index level.
 *   - The plaintext token escapes this service ONLY in the response returned by `issue()`.
 */
@Injectable()
export class InvitationsService {
    private readonly logger = new Logger(InvitationsService.name);
    private readonly invitationBaseUrl: string;

    public constructor(
        private readonly invitationsRepository: InvitationsRepository,
        configService: ConfigService,
    ) {
        this.invitationBaseUrl = configService.get<string>('INVITATION_BASE_URL') ?? DEFAULT_INVITATION_BASE_URL;
    }

    /**
     * Issue an invitation inside the caller's transaction. Returns the persisted entity
     * AND the plaintext token (the only path the plaintext takes out of the service).
     */
    public async issueWithinTransaction(
        manager: EntityManager,
        params: { purchaseId: number; studentEmail: string },
    ): Promise<{ entity: InvitationEntity; plaintextToken: string }> {
        const plaintextToken = this.generatePlaintextToken();
        const tokenHash = this.hashToken(plaintextToken);
        const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * MILLIS_PER_DAY);

        const entity = await this.invitationsRepository.insertWithinTransaction(manager, {
            purchaseId: params.purchaseId,
            tokenHash,
            studentEmail: params.studentEmail,
            status: InvitationStatusEnum.ISSUED,
            expiresAt,
        });

        this.logger.log(`Invitation issued: id=${entity.invitationId} purchaseId=${entity.purchaseId}`);

        return { entity, plaintextToken };
    }

    public toResponseWithPlaintext(entity: InvitationEntity, plaintextToken: string): IInvitationResponse {
        return {
            id: entity.invitationId,
            studentEmail: entity.studentEmail,
            status: entity.status,
            expiresAt: entity.expiresAt.toISOString(),
            url: this.buildInvitationUrl(plaintextToken),
        };
    }

    public hashToken(plaintext: string): string {
        return createHash(INVITATION_TOKEN_HASH_ALGORITHM).update(plaintext).digest('hex');
    }

    private generatePlaintextToken(): string {
        return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
    }

    private buildInvitationUrl(plaintextToken: string): string {
        const separator = this.invitationBaseUrl.includes('?') ? '&' : '?';

        return `${this.invitationBaseUrl}${separator}${INVITATION_TOKEN_QUERY_PARAM}=${encodeURIComponent(plaintextToken)}`;
    }
}
