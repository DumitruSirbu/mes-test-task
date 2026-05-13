import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { EnrolmentEntity } from '../entity/EnrolmentEntity';
import { EnrolmentAlreadyExistsError } from '../../common/error/EnrolmentAlreadyExistsError';
import { PG_UNIQUE_VIOLATION } from '../../auth/const/AuthConsts';

interface IInsertEnrolmentParams {
    studentUserId: number;
    courseId: number;
    sourceInvitationId: number;
}

/**
 * Repository for `enrolments`. Exposes only intention-revealing queries.
 *
 * `insertWithinTransaction` accepts an `EntityManager` so the user creation + enrolment
 * insert can participate in the same TypeORM transaction as invitation redemption
 * (atomic multi-write per ADR 0006).
 */
@Injectable()
export class EnrolmentsRepository extends BaseRepository<EnrolmentEntity> {
    public constructor(@InjectRepository(EnrolmentEntity) repository: Repository<EnrolmentEntity>) {
        super(repository);
    }

    public async insertWithinTransaction(manager: EntityManager, params: IInsertEnrolmentParams): Promise<EnrolmentEntity> {
        const entity = manager.create(EnrolmentEntity, {
            studentUserId: params.studentUserId,
            courseId: params.courseId,
            sourceInvitationId: params.sourceInvitationId,
        });

        try {
            return await manager.save(EnrolmentEntity, entity);
        } catch (error) {
            if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
                throw new EnrolmentAlreadyExistsError(error);
            }

            throw error;
        }
    }
}
