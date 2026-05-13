import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * M04 — create `purchases` table and the `purchase_status` native PostgreSQL ENUM.
 *
 * v1 declares the ENUM with only `'COMPLETED'` per data-model.md state-machine note;
 * `PENDING` / `FAILED` are added via `ALTER TYPE ... ADD VALUE` in v2 when a real PSP lands.
 *
 * Indices match data-model.md "Indexes (consolidated)":
 *   - IDX_purchases_parent (BTREE) — FK index + `GET /me/purchases`
 *   - IDX_purchases_status (BTREE) — admin filters
 *   - IDX_purchases_parent_idemkey_unique (UNIQUE) — secondary idempotency safety net
 */
export class CreatePurchasesTable20260513150100 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "purchase_status" AS ENUM ('COMPLETED')`);

        await queryRunner.createTable(
            new Table({
                name: 'purchases',
                columns: [
                    {
                        name: 'purchase_id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'parent_user_id', type: 'integer', isNullable: false },
                    { name: 'course_id', type: 'integer', isNullable: false },
                    { name: 'status', type: 'purchase_status', isNullable: false },
                    { name: 'amount_pence', type: 'integer', isNullable: false },
                    { name: 'idempotency_key', type: 'varchar', length: '64', isNullable: false },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                ],
                checks: [{ name: 'CHK_purchases_amount_pence_non_negative', expression: '"amount_pence" >= 0' }],
            }),
            true,
        );

        await queryRunner.createForeignKeys('purchases', [
            new TableForeignKey({
                name: 'FK_purchases_parent_user_id',
                columnNames: ['parent_user_id'],
                referencedTableName: 'users',
                referencedColumnNames: ['user_id'],
                onDelete: 'RESTRICT',
                onUpdate: 'CASCADE',
            }),
            new TableForeignKey({
                name: 'FK_purchases_course_id',
                columnNames: ['course_id'],
                referencedTableName: 'courses',
                referencedColumnNames: ['course_id'],
                onDelete: 'RESTRICT',
                onUpdate: 'CASCADE',
            }),
        ]);

        await queryRunner.createIndices('purchases', [
            new TableIndex({ name: 'IDX_purchases_parent', columnNames: ['parent_user_id'] }),
            new TableIndex({ name: 'IDX_purchases_status', columnNames: ['status'] }),
            new TableIndex({
                name: 'IDX_purchases_parent_idemkey_unique',
                columnNames: ['parent_user_id', 'idempotency_key'],
                isUnique: true,
            }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('purchases', 'IDX_purchases_parent_idemkey_unique');
        await queryRunner.dropIndex('purchases', 'IDX_purchases_status');
        await queryRunner.dropIndex('purchases', 'IDX_purchases_parent');
        await queryRunner.dropForeignKey('purchases', 'FK_purchases_course_id');
        await queryRunner.dropForeignKey('purchases', 'FK_purchases_parent_user_id');
        await queryRunner.dropTable('purchases', true);
        await queryRunner.query(`DROP TYPE IF EXISTS "purchase_status"`);
    }
}
