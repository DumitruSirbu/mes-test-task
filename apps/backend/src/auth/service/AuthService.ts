import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import type { StringValue } from 'ms';
import { UserRoleEnum } from '@mes/shared';
import type { IJwtPayload } from '@mes/shared';
import { UsersRepository } from '../../users/repository/UsersRepository';
import { UsersService } from '../../users/service/UsersService';
import { UserEntity } from '../../users/entity/UserEntity';
import { UserEmailTakenError } from '../../common/error/UserEmailTakenError';
import { UnauthorizedError } from '../../common/error/UnauthorizedError';
import {
    ARGON2_MEMORY_COST,
    ARGON2_PARALLELISM,
    ARGON2_TIME_COST,
    DEFAULT_JWT_EXPIRES_IN,
    DEFAULT_JWT_EXPIRES_IN_SECONDS,
    DUMMY_HASH_SENTINEL,
    PG_UNIQUE_VIOLATION,
} from '../const/AuthConsts';
import { LoginDto } from '../dto/LoginDto';
import { SignupDto } from '../dto/SignupDto';
import { IAuthTokenResponse } from '../interface/IAuthTokenResponse';
import { IAuthUserProfile } from '../interface/IAuthUserProfile';

/**
 * AuthService — owns signup, login, and profile projection.
 *
 * - signup creates a PARENT user; client cannot pick the role (see SignupDto rationale).
 * - login verifies argon2id, re-hashes transparently when parameters drift, returns a JWT.
 * - me projects a fresh user row into `IAuthUserProfile` (never includes the password hash).
 */
@Injectable()
export class AuthService implements OnModuleInit {
    private readonly logger = new Logger(AuthService.name);
    private readonly jwtExpiresIn: string;

    /**
     * Pre-computed dummy hash used on the unknown-email path to keep timing constant
     * regardless of whether an email exists. Starts as the compile-time sentinel so
     * `verifyDummy` never throws a format error before `onModuleInit` completes.
     * `onModuleInit` replaces it with a freshly hashed value using the current parameters.
     */
    private dummyHash: string = DUMMY_HASH_SENTINEL;

    public constructor(
        private readonly usersRepository: UsersRepository,
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
        configService: ConfigService,
    ) {
        this.jwtExpiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_JWT_EXPIRES_IN;
    }

    public async onModuleInit(): Promise<void> {
        this.dummyHash = await this.hashPassword('__dummy__');
    }

    public async signup(input: SignupDto): Promise<IAuthTokenResponse> {
        const existing = await this.usersRepository.findByEmail(input.email);

        if (existing) {
            throw new UserEmailTakenError();
        }

        const passwordHash = await this.hashPassword(input.password);
        let user: UserEntity;

        try {
            user = await this.usersRepository.insertUser({
                email: input.email,
                passwordHash,
                role: UserRoleEnum.PARENT,
                firstName: input.firstName ?? null,
                lastName: input.lastName ?? null,
            });
        } catch (error) {
            if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
                throw new UserEmailTakenError();
            }

            throw error;
        }

        this.logger.log(`User signed up: id=${user.userId} role=${user.role}`);

        return this.issueToken(user);
    }

    public async login(input: LoginDto): Promise<IAuthTokenResponse> {
        const user = await this.usersRepository.findByEmail(input.email);

        if (!user) {
            // Constant-ish cost: verify against the dummy hash so timing does not reveal absence.
            await this.verifyDummy(input.password);
            throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS');
        }

        const matches = await argon2.verify(user.passwordHash, input.password);

        if (!matches) {
            throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS');
        }

        void this.rehashIfNeeded(user, input.password).catch((err) =>
            this.logger.warn(`Transparent argon2 re-hash scheduling failed for user ${user.userId}: ${(err as Error).message}`),
        );

        return this.issueToken(user);
    }

    public async getProfile(userId: number): Promise<IAuthUserProfile> {
        const user = await this.usersService.findById(userId);

        if (!user) {
            // The JWT was valid but the user row is gone (deleted between sign + lookup).
            throw new UnauthorizedError('AUTH_INVALID_TOKEN');
        }

        return {
            id: user.userId,
            email: user.email,
            role: user.role,
            firstName: user.firstName ?? null,
            lastName: user.lastName ?? null,
        };
    }

    private async hashPassword(plain: string): Promise<string> {
        return argon2.hash(plain, {
            type: argon2.argon2id,
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        });
    }

    private async verifyDummy(plain: string): Promise<void> {
        try {
            await argon2.verify(this.dummyHash, plain);
        } catch (error) {
            this.logger.warn({ code: 'ARGON2_DUMMY_VERIFY_FAILED', reason: (error as Error).message }, 'Argon2 dummy verify threw unexpectedly');
        }
    }

    private async rehashIfNeeded(user: UserEntity, plain: string): Promise<void> {
        const needsRehash = argon2.needsRehash(user.passwordHash, {
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        });

        if (!needsRehash) {
            return;
        }

        try {
            const fresh = await this.hashPassword(plain);
            await this.usersService.updatePasswordHash(user.userId, fresh);
        } catch (error) {
            // Re-hash is best-effort; the login itself already succeeded.
            this.logger.warn(`Transparent argon2 re-hash failed for user ${user.userId}: ${(error as Error).message}`);
        }
    }

    private issueToken(user: UserEntity): IAuthTokenResponse {
        const payload: Pick<IJwtPayload, 'sub' | 'role'> = { sub: user.userId, role: user.role };
        // assertJwtConfig validated the format of jwtExpiresIn against JWT_EXPIRES_IN_REGEX.
        // The single `as` narrows from the wider `string` returned by ConfigService to the
        // branded template-literal union `StringValue` required by jsonwebtoken's sign API.
        const accessToken = this.jwtService.sign(payload, { expiresIn: this.jwtExpiresIn as StringValue });

        return { accessToken, expiresIn: this.toExpiresInSeconds(this.jwtExpiresIn) };
    }

    private toExpiresInSeconds(expiresIn: string): number {
        // Accept '15m', '900s', '1h', '1d'.
        const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());

        if (!match) {
            return DEFAULT_JWT_EXPIRES_IN_SECONDS;
        }

        const value = Number(match[1]);
        const unit = match[2];
        const unitToSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
        const seconds = value * unitToSeconds[unit];

        return seconds;
    }
}
