import { Injectable } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { IdempotencyKeysRepository } from '../repository/IdempotencyKeysRepository';
import { IdempotencyKeyEntity } from '../entity/IdempotencyKeyEntity';
import { IDEMPOTENCY_PG_UNIQUE_VIOLATION } from '../const/IdempotencyConsts';
import { IdempotencyBodyMismatchError } from '../../error/IdempotencyBodyMismatchError';
import { IdempotencyKeyReusedError } from '../../error/IdempotencyKeyReusedError';

interface IPersistArgs {
    manager: EntityManager;
    key: string;
    userId: number;
    endpoint: string;
    requestHash: string;
    responseStatus: number;
    responseBody: object;
}

interface IUniqueViolationLike {
    code?: string;
    driverError?: { code?: string };
}

/**
 * Reusable helpers for the idempotency protocol.
 *
 * The interceptor uses `findReplay` to short-circuit on a hit. Services use
 * `persistWithinTransaction` to write the canonical response row inside the same
 * transaction as the business row (so the two cannot drift).
 *
 * When two concurrent requests race past the SELECT and both try to INSERT, the
 * second one trips the UNIQUE index. This service catches that case, re-reads the
 * row, and either returns it (replay path — the caller's transaction will fail at
 * commit but the second request's interceptor reply uses the now-present row) or
 * throws `IdempotencyBodyMismatchError` when the stored body hash differs. Per
 * ADR 0006, the raw QueryFailedError never surfaces.
 */
@Injectable()
export class IdempotencyService {
    public constructor(private readonly idempotencyKeysRepository: IdempotencyKeysRepository) {}

    public async findReplay(userId: number, endpoint: string, key: string): Promise<IdempotencyKeyEntity | null> {
        return this.idempotencyKeysRepository.findReplay(userId, endpoint, key);
    }

    public async persistWithinTransaction(args: IPersistArgs): Promise<IdempotencyKeyEntity> {
        try {
            return await this.idempotencyKeysRepository.insertWithinTransaction(args.manager, {
                key: args.key,
                userId: args.userId,
                endpoint: args.endpoint,
                requestHash: args.requestHash,
                responseStatus: args.responseStatus,
                responseBody: args.responseBody,
            });
        } catch (error) {
            if (this.isUniqueViolation(error)) {
                // A racing request beat us to the INSERT. Re-read and disambiguate.
                const existing = await this.idempotencyKeysRepository.findReplay(args.userId, args.endpoint, args.key);

                if (existing && existing.requestHash !== args.requestHash) {
                    throw new IdempotencyBodyMismatchError(error);
                }

                // Same key, same body, concurrent in-flight request — per ADR 0006 the client
                // SHOULD retry shortly. The first transaction will commit and serve the replay.
                throw new IdempotencyKeyReusedError(error);
            }

            throw error;
        }
    }

    private isUniqueViolation(error: unknown): boolean {
        if (!(error instanceof QueryFailedError)) {
            return false;
        }

        const driverError = (error as IUniqueViolationLike).driverError;

        return driverError?.code === IDEMPOTENCY_PG_UNIQUE_VIOLATION;
    }
}
