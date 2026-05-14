import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * M10 — create `refresh_tokens` table per ADR 0007 §3.
 *
 * Design notes:
 *   - `id` is BIGSERIAL (64-bit) to accommodate the sliding-window volume at scale.
 *   - `token_hash` CHAR(64) stores the SHA-256 hex of the raw opaque token.
 *     The UNIQUE index is the collision safety net (hard-fail on double-insert).
 *   - `family_id` UUID groups all rotations descended from one initial login.
 *   - `replaced_by_id` is a self-FK to the successor row; NULL on the latest active token.
 *   - `ip` uses the Postgres INET type for v4/v6 address storage without string waste.
 *   - `onDelete: RESTRICT` on `user_id` FK — prevents dropping a user while live sessions exist.
 *   - `onDelete: SET NULL` on self-FK `replaced_by_id` — if the successor row is ever deleted,
 *     nullify the pointer (avoids orphan FK violation during retention cleanup).
 */
export class CreateRefreshTokensTable20260514130000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'refresh_tokens',
                columns: [
                    {
                        name: 'id',
                        type: 'bigint',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    {
                        name: 'user_id',
                        type: 'bigint',
                        isNullable: false,
                    },
                    {
                        name: 'family_id',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'token_hash',
                        type: 'char',
                        length: '64',
                        isNullable: false,
                        isUnique: true,
                    },
                    {
                        name: 'issued_at',
                        type: 'timestamptz',
                        isNullable: false,
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'expires_at',
                        type: 'timestamptz',
                        isNullable: false,
                    },
                    {
                        name: 'revoked_at',
                        type: 'timestamptz',
                        isNullable: true,
                    },
                    {
                        name: 'replaced_by_id',
                        type: 'bigint',
                        isNullable: true,
                    },
                    {
                        name: 'user_agent',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'ip',
                        type: 'inet',
                        isNullable: true,
                    },
                ],
            }),
            true,
        );

        await queryRunner.createForeignKeys('refresh_tokens', [
            new TableForeignKey({
                name: 'FK_refresh_tokens_user_id',
                columnNames: ['user_id'],
                referencedTableName: 'users',
                referencedColumnNames: ['user_id'],
                onDelete: 'RESTRICT',
                onUpdate: 'CASCADE',
            }),
            new TableForeignKey({
                name: 'FK_refresh_tokens_replaced_by_id',
                columnNames: ['replaced_by_id'],
                referencedTableName: 'refresh_tokens',
                referencedColumnNames: ['id'],
                onDelete: 'SET NULL',
                onUpdate: 'CASCADE',
            }),
        ]);

        await queryRunner.createIndices('refresh_tokens', [
            new TableIndex({
                name: 'IDX_refresh_tokens_token_hash_unique',
                columnNames: ['token_hash'],
                isUnique: true,
            }),
            new TableIndex({
                name: 'IDX_refresh_tokens_family_id',
                columnNames: ['family_id'],
            }),
            new TableIndex({
                name: 'IDX_refresh_tokens_user_id_revoked_at',
                columnNames: ['user_id', 'revoked_at'],
            }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('refresh_tokens', 'IDX_refresh_tokens_user_id_revoked_at');
        await queryRunner.dropIndex('refresh_tokens', 'IDX_refresh_tokens_family_id');
        await queryRunner.dropIndex('refresh_tokens', 'IDX_refresh_tokens_token_hash_unique');
        await queryRunner.dropForeignKey('refresh_tokens', 'FK_refresh_tokens_replaced_by_id');
        await queryRunner.dropForeignKey('refresh_tokens', 'FK_refresh_tokens_user_id');
        await queryRunner.dropTable('refresh_tokens', true);
    }
}
