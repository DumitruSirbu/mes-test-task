import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { UserEntity } from '../entity/UserEntity';
import { ICreateUserInput } from '../interface/ICreateUserInput';

/**
 * Concrete repository for `users`. Only exposes intention-revealing queries —
 * the raw TypeORM repository is encapsulated by `BaseRepository`.
 */
@Injectable()
export class UsersRepository extends BaseRepository<UserEntity> {
    public constructor(@InjectRepository(UserEntity) repository: Repository<UserEntity>) {
        super(repository);
    }

    public async findById(userId: number): Promise<UserEntity | null> {
        return this.findOne({ userId });
    }

    public async findByEmail(email: string): Promise<UserEntity | null> {
        return this.findOne({ email: email.trim().toLowerCase() });
    }

    public async insertUser(input: ICreateUserInput): Promise<UserEntity> {
        return this.create(input);
    }

    /**
     * Insert a user inside the caller's `EntityManager` so the row participates in the
     * surrounding transaction (e.g. invitation redemption — user + enrolment must commit
     * atomically per ADR 0006).
     */
    public async insertUserWithinTransaction(manager: EntityManager, input: ICreateUserInput): Promise<UserEntity> {
        const entity = manager.create(UserEntity, input);

        return manager.save(UserEntity, entity);
    }

    /**
     * Issues a targeted partial UPDATE on the `password_hash` column only.
     *
     * Uses `repository.update()` directly rather than `BaseRepository.create()` (save) to
     * avoid loading the full entity into memory and to bypass `@BeforeUpdate` lifecycle
     * hooks that might re-hash an already-hashed value. This is intentional for the
     * transparent argon2 re-hash path where the caller already holds the new hash.
     */
    public async updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
        await this.repository.update({ userId }, { passwordHash });
    }
}
