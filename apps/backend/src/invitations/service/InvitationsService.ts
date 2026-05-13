import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { InvitationStatusEnum, UserRoleEnum } from '@mes/shared';
import type { IAuthTokenResponse, IInvitationResponse, IInvitationMetaResponse } from '@mes/shared';
import { InvitationEntity } from '../entity/InvitationEntity';
import { InvitationsRepository } from '../repository/InvitationsRepository';
import { UsersRepository } from '../../users/repository/UsersRepository';
import { EnrolmentsRepository } from '../../enrolments/repository/EnrolmentsRepository';
import { AuthService } from '../../auth/service/AuthService';
import { UserEntity } from '../../users/entity/UserEntity';
import { InvitationNotFoundError } from '../../common/error/InvitationNotFoundError';
import { InvitationExpiredError } from '../../common/error/InvitationExpiredError';
import { InvitationAlreadyRedeemedError } from '../../common/error/InvitationAlreadyRedeemedError';
import { InvitationEmailConflictError } from '../../common/error/InvitationEmailConflictError';
import { ARGON2_MEMORY_COST, ARGON2_PARALLELISM, ARGON2_TIME_COST, PG_UNIQUE_VIOLATION } from '../../auth/const/AuthConsts';
import {
    DEFAULT_INVITATION_BASE_URL,
    INVITATION_EXPIRY_DAYS,
    INVITATION_TOKEN_HASH_ALGORITHM,
    MILLIS_PER_DAY,
    TOKEN_BYTE_LENGTH,
} from '../const/InvitationsConsts';
import { RedeemInvitationDto } from '../dto/RedeemInvitationDto';

/**
 * Owns invitation issuance, meta lookup, and redemption.
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
        private readonly usersRepository: UsersRepository,
        private readonly enrolmentsRepository: EnrolmentsRepository,
        private readonly authService: AuthService,
        private readonly dataSource: DataSource,
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

    /**
     * Open a transaction, redeem the invitation atomically, then issue a JWT.
     * The controller calls only this method — no transaction wiring in the controller.
     */
    public async redeem(dto: RedeemInvitationDto): Promise<IAuthTokenResponse> {
        const { user } = await this.dataSource.transaction(async (manager) => {
            return this.redeemInTransaction(manager, dto);
        });

        return this.authService.issueToken(user);
    }

    /**
     * Redeem an invitation atomically inside the caller's transaction.
     *
     * Algorithm:
     *   1. Hash the plaintext token.
     *   2. Atomic conditional UPDATE (ISSUED + not expired → REDEEMED). If 0 rows: disambiguate.
     *   3. Check for email conflict against `users` table.
     *   4. Hash password with argon2id.
     *   5. Insert new STUDENT user.
     *   6. Insert enrolment row.
     *   7. Return the newly created `UserEntity` so the caller can issue a JWT.
     */
    public async redeemInTransaction(manager: EntityManager, params: RedeemInvitationDto): Promise<{ user: UserEntity }> {
        const tokenHash = this.hashToken(params.token);
        const invitation = await this.resolveOrThrow(manager, tokenHash);

        const existingUser = await this.usersRepository.findByEmail(invitation.studentEmail);

        if (existingUser) {
            throw new InvitationEmailConflictError();
        }

        const passwordHash = await this.hashPassword(params.password);
        const newUser = await this.insertStudentUser(manager, params, invitation.studentEmail, passwordHash);

        const courseId = await this.resolveCourseId(manager, invitation);

        await this.enrolmentsRepository.insertWithinTransaction(manager, {
            studentUserId: newUser.userId,
            courseId,
            sourceInvitationId: invitation.invitationId,
        });

        this.logger.log(`Invitation redeemed: id=${invitation.invitationId} newUserId=${newUser.userId}`);

        return { user: newUser };
    }

    /**
     * Return meta for the invitation identified by `token` so the student can preview
     * details before submitting the redemption form. Returned even for redeemed
     * invitations so the UI can show a "already used" message.
     */
    public async getMetaByToken(token: string): Promise<IInvitationMetaResponse> {
        const tokenHash = this.hashToken(token);

        const invitation = await this.invitationsRepository.findByTokenHashWithRelations(tokenHash);

        if (!invitation) {
            throw new InvitationNotFoundError();
        }

        const purchase = invitation.purchase;

        if (!purchase || !purchase.course || !purchase.parent) {
            throw new InvitationNotFoundError();
        }

        return {
            courseTitle: purchase.course.title,
            parentEmail: purchase.parent.email,
            studentEmail: invitation.studentEmail,
            expiresAt: invitation.expiresAt.toISOString(),
            status: invitation.status,
        };
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

    private async resolveOrThrow(manager: EntityManager, tokenHash: string): Promise<InvitationEntity> {
        const redeemed = await this.invitationsRepository.atomicRedeem(manager, tokenHash);

        if (redeemed) {
            return redeemed;
        }

        const existing = await this.invitationsRepository.findByTokenHash(tokenHash);

        if (!existing) {
            throw new InvitationNotFoundError();
        }

        if (existing.status === InvitationStatusEnum.REDEEMED) {
            throw new InvitationAlreadyRedeemedError();
        }

        throw new InvitationExpiredError();
    }

    private async insertStudentUser(manager: EntityManager, params: RedeemInvitationDto, email: string, passwordHash: string): Promise<UserEntity> {
        try {
            return await this.usersRepository.insertUserWithinTransaction(manager, {
                email,
                passwordHash,
                role: UserRoleEnum.STUDENT,
                firstName: params.firstName,
                lastName: params.lastName,
                dateOfBirth: params.dateOfBirth,
            });
        } catch (error) {
            if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
                throw new InvitationEmailConflictError(error);
            }

            throw error;
        }
    }

    private async resolveCourseId(manager: EntityManager, invitation: InvitationEntity): Promise<number> {
        if (invitation.purchase?.courseId !== undefined) {
            return invitation.purchase.courseId;
        }

        return this.invitationsRepository.findCourseIdByPurchaseId(manager, invitation.purchaseId);
    }

    private async hashPassword(plain: string): Promise<string> {
        return argon2.hash(plain, {
            type: argon2.argon2id,
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        });
    }

    private generatePlaintextToken(): string {
        return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
    }

    private buildInvitationUrl(plaintextToken: string): string {
        return `${this.invitationBaseUrl}/${encodeURIComponent(plaintextToken)}`;
    }
}
