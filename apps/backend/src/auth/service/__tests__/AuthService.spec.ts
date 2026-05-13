import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { UserRoleEnum } from '@mes/shared';
import { AuthService } from '../AuthService';
import { UsersRepository } from '../../../users/repository/UsersRepository';
import { UsersService } from '../../../users/service/UsersService';
import { UserEmailTakenError } from '../../../common/error/UserEmailTakenError';
import { UnauthorizedError } from '../../../common/error/UnauthorizedError';
import { UserEntity } from '../../../users/entity/UserEntity';
import { ARGON2_MEMORY_COST, ARGON2_PARALLELISM, ARGON2_TIME_COST } from '../../const/AuthConsts';
import { ICreateUserInput } from '../../../users/interface/ICreateUserInput';
import { IAuthUserProfile } from '../../interface/IAuthUserProfile';

type UsersRepositoryMock = Pick<UsersRepository, 'findByEmail' | 'findById' | 'insertUser' | 'updatePasswordHash'>;
type UsersServiceMock = Pick<UsersService, 'findById' | 'findByEmail' | 'updatePasswordHash'>;
type JwtServiceMock = Pick<JwtService, 'sign'>;

describe('AuthService', () => {
    let service: AuthService;

    // Standalone mock functions — referenced directly in assertions to avoid
    // the @typescript-eslint/unbound-method rule that fires on method destructuring.
    const findByEmailMock = jest.fn();
    const findByIdMock = jest.fn();
    const insertUserMock = jest.fn();
    const updatePasswordHashMock = jest.fn();
    const findByIdServiceMock = jest.fn();
    const findByEmailServiceMock = jest.fn();
    const updatePasswordHashServiceMock = jest.fn();
    const signMock = jest.fn().mockReturnValue('jwt-token');

    const buildUser = (overrides?: Partial<UserEntity>): UserEntity => {
        const entity = new UserEntity();
        entity.userId = 1;
        entity.email = 'parent@mes.test';
        entity.passwordHash = 'hash-placeholder';
        entity.role = UserRoleEnum.PARENT;
        entity.firstName = null;
        entity.lastName = null;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();

        return Object.assign(entity, overrides ?? {});
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        signMock.mockReturnValue('jwt-token');

        const usersRepositoryMock: UsersRepositoryMock = {
            findByEmail: findByEmailMock,
            findById: findByIdMock,
            insertUser: insertUserMock,
            updatePasswordHash: updatePasswordHashMock,
        };

        const usersServiceMock: UsersServiceMock = {
            findById: findByIdServiceMock,
            findByEmail: findByEmailServiceMock,
            updatePasswordHash: updatePasswordHashServiceMock,
        };

        const jwtServiceMock: JwtServiceMock = {
            sign: signMock,
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: UsersRepository, useValue: usersRepositoryMock },
                { provide: UsersService, useValue: usersServiceMock },
                { provide: JwtService, useValue: jwtServiceMock },
                { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('15m') } },
            ],
        }).compile();

        service = moduleRef.get(AuthService);
        // Trigger OnModuleInit so dummyHash is populated before any test runs.
        await moduleRef.init();
    });

    describe('signup', () => {
        it('hashes the password and persists a PARENT user', async () => {
            findByEmailMock.mockResolvedValue(null);
            insertUserMock.mockImplementation((entity: ICreateUserInput) => Promise.resolve(buildUser({ ...entity })));

            const result = await service.signup({ email: 'parent@mes.test', password: 'correcthorse12' });

            expect(insertUserMock).toHaveBeenCalledTimes(1);
            const firstCallArgs = insertUserMock.mock.calls[0] as [ICreateUserInput];
            const persisted = firstCallArgs[0];
            expect(persisted.role).toBe(UserRoleEnum.PARENT);
            expect(persisted.passwordHash).toBeDefined();
            expect(persisted.passwordHash).not.toBe('correcthorse12');
            expect(await argon2.verify(persisted.passwordHash, 'correcthorse12')).toBe(true);
            expect(result.accessToken).toBe('jwt-token');
            expect(result.expiresIn).toBe(900);
        });

        it('throws UserEmailTakenError when the email already exists', async () => {
            findByEmailMock.mockResolvedValue(buildUser());

            await expect(service.signup({ email: 'parent@mes.test', password: 'correcthorse12' })).rejects.toBeInstanceOf(UserEmailTakenError);
            expect(insertUserMock).not.toHaveBeenCalled();
        });

        it('throws UserEmailTakenError when a concurrent insert triggers a PG unique violation', async () => {
            const { QueryFailedError } = await import('typeorm');
            findByEmailMock.mockResolvedValue(null);

            const pgUniqueError = new QueryFailedError('INSERT', [], { code: '23505' } as unknown as Error);
            insertUserMock.mockRejectedValue(pgUniqueError);

            await expect(service.signup({ email: 'race@mes.test', password: 'correcthorse12' })).rejects.toBeInstanceOf(UserEmailTakenError);
        });
    });

    describe('login', () => {
        it('issues a token when credentials match', async () => {
            const passwordHash = await argon2.hash('correcthorse12', {
                type: argon2.argon2id,
                memoryCost: ARGON2_MEMORY_COST,
                timeCost: ARGON2_TIME_COST,
                parallelism: ARGON2_PARALLELISM,
            });
            findByEmailMock.mockResolvedValue(buildUser({ passwordHash }));

            const result = await service.login({ email: 'parent@mes.test', password: 'correcthorse12' });

            expect(result.accessToken).toBe('jwt-token');
            expect(signMock).toHaveBeenCalledWith({ sub: 1, role: UserRoleEnum.PARENT }, { expiresIn: '15m' });
        });

        it('throws AUTH_INVALID_CREDENTIALS when the email is unknown', async () => {
            findByEmailMock.mockResolvedValue(null);

            await expect(service.login({ email: 'nobody@mes.test', password: 'whatever-12' })).rejects.toMatchObject({
                code: 'AUTH_INVALID_CREDENTIALS',
            });
        });

        it('throws AUTH_INVALID_CREDENTIALS when the password mismatches', async () => {
            const passwordHash = await argon2.hash('the-real-one-12', {
                type: argon2.argon2id,
                memoryCost: ARGON2_MEMORY_COST,
                timeCost: ARGON2_TIME_COST,
                parallelism: ARGON2_PARALLELISM,
            });
            findByEmailMock.mockResolvedValue(buildUser({ passwordHash }));

            await expect(service.login({ email: 'parent@mes.test', password: 'wrong-password-1' })).rejects.toBeInstanceOf(UnauthorizedError);
        });
    });

    describe('getProfile', () => {
        it('projects the persisted user without exposing the password hash', async () => {
            findByIdServiceMock.mockResolvedValue(buildUser({ firstName: 'Ada', lastName: 'Lovelace' }));

            const profile = await service.getProfile(1);

            expect(profile).toEqual({
                id: 1,
                email: 'parent@mes.test',
                role: UserRoleEnum.PARENT,
                firstName: 'Ada',
                lastName: 'Lovelace',
            });
            expect(Reflect.get(profile satisfies IAuthUserProfile, 'passwordHash')).toBeUndefined();
        });

        it('throws AUTH_INVALID_TOKEN when the user has been deleted', async () => {
            findByIdServiceMock.mockResolvedValue(null);

            await expect(service.getProfile(999)).rejects.toMatchObject({ code: 'AUTH_INVALID_TOKEN' });
        });
    });
});
