import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * `idempotency_keys` table — replay-safe storage for POST endpoints.
 *
 * Per data-model.md + ADR 0006: keys are scoped per `(user_id, endpoint, key)` via a
 * UNIQUE index; rows are retained for audit even if the user is deleted (no FK).
 *
 * The 24h retention sweep is documented as future work; v1 lets the table grow.
 */
@Entity({ name: 'idempotency_keys', synchronize: false })
export class IdempotencyKeyEntity {
    @PrimaryGeneratedColumn({ name: 'idempotency_key_id' })
    public idempotencyKeyId!: number;

    @Column({ name: 'key', type: 'varchar', length: 64 })
    public key!: string;

    @Column({ name: 'user_id', type: 'integer' })
    public userId!: number;

    @Column({ name: 'endpoint', type: 'varchar', length: 120 })
    public endpoint!: string;

    @Column({ name: 'request_hash', type: 'varchar', length: 64 })
    public requestHash!: string;

    @Column({ name: 'response_status', type: 'smallint' })
    public responseStatus!: number;

    @Column({ name: 'response_body', type: 'jsonb' })
    public responseBody!: object;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;
}
