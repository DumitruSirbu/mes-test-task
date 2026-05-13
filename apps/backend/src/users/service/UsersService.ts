import { Injectable } from '@nestjs/common';
import { UserEntity } from '../entity/UserEntity';
import { UsersRepository } from '../repository/UsersRepository';

/**
 * Thin pass-through over `UsersRepository` for the read-side, plus the single update path
 * needed by the transparent argon2 re-hash on login. Auth-specific writes (signup) live
 * in `AuthService` because they couple the user row to password hashing.
 */
@Injectable()
export class UsersService {
    public constructor(private readonly usersRepository: UsersRepository) {}

    public async findById(userId: number): Promise<UserEntity | null> {
        return this.usersRepository.findById(userId);
    }

    public async findByEmail(email: string): Promise<UserEntity | null> {
        return this.usersRepository.findByEmail(email);
    }

    public async updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
        await this.usersRepository.updatePasswordHash(userId, passwordHash);
    }
}
