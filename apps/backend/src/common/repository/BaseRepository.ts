import { DeepPartial, FindManyOptions, ObjectLiteral, Repository } from 'typeorm';

/**
 * Abstract base for all domain repositories.
 *
 * Wraps a TypeORM `Repository<T>` and exposes a small protected surface
 * (`findAll`, `create`, `insertManyIgnoreConflicts`) so concrete repositories
 * only expose intention-revealing public methods to services. Services must
 * never see a raw `Repository<T>` — that is the whole point of the pattern.
 *
 * Concrete repositories inject the TypeORM repository via `@InjectRepository`
 * and pass it to `super(repository)` in their constructor.
 */
export abstract class BaseRepository<T extends ObjectLiteral> {
    protected constructor(protected readonly repository: Repository<T>) {}

    /**
     * Fetch every row, optionally filtered/ordered via standard TypeORM options.
     * Intended for small lookup tables — paginate via a dedicated method for
     * anything that can grow unbounded.
     */
    protected async findAll(options?: FindManyOptions<T>): Promise<T[]> {
        return this.repository.find(options);
    }

    /**
     * Persist a single new row. Returns the saved entity (with generated id /
     * timestamps populated).
     */
    protected async create(entity: DeepPartial<T>): Promise<T> {
        const instance = this.repository.create(entity);
        return this.repository.save(instance);
    }

    /**
     * Bulk insert that silently ignores rows that violate a unique constraint.
     * Used by ETL / seed paths where the caller has already deduplicated the
     * input in-memory and considers duplicate-key collisions a no-op.
     *
     * Pass an empty array → no-op (TypeORM's `.insert([])` rejects).
     */
    protected async insertManyIgnoreConflicts(entities: DeepPartial<T>[]): Promise<void> {
        if (entities.length === 0) {
            return;
        }
        await this.repository
            .createQueryBuilder()
            .insert()
            .values(entities as never)
            .orIgnore()
            .execute();
    }
}
