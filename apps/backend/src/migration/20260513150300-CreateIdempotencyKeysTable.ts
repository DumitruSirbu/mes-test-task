import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * M04 — create `idempotency_keys` table.
 *
 * Per data-model.md: no FK on `user_id` so keys outlive deleted users (audit retention).
 * The UNIQUE index `(user_id, endpoint, key)` is both the lookup index AND the race
 * detector — see ADR 0006. A 24h retention sweep is documented as v2 work.
 */
export class CreateIdempotencyKeysTable20260513150300 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'idempotency_keys',
                columns: [
                    {
                        name: 'idempotency_key_id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'key', type: 'varchar', length: '64', isNullable: false },
                    { name: 'user_id', type: 'integer', isNullable: false },
                    { name: 'endpoint', type: 'varchar', length: '120', isNullable: false },
                    { name: 'request_hash', type: 'varchar', length: '64', isNullable: false },
                    { name: 'response_status', type: 'smallint', isNullable: false },
                    { name: 'response_body', type: 'jsonb', isNullable: false },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                ],
            }),
            true,
        );

        await queryRunner.createIndices('idempotency_keys', [
            new TableIndex({
                name: 'IDX_idempotency_keys_user_endpoint_key_unique',
                columnNames: ['user_id', 'endpoint', 'key'],
                isUnique: true,
            }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('idempotency_keys', 'IDX_idempotency_keys_user_endpoint_key_unique');
        await queryRunner.dropTable('idempotency_keys', true);
    }
}
