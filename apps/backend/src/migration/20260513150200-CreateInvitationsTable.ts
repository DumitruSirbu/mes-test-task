import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * M04 — create `invitations` table and the `invitation_status` native PostgreSQL ENUM.
 *
 * `email_sent_at` is created up-front so the M08 BullMQ processor needs no schema change.
 * Indices match data-model.md "Indexes (consolidated)":
 *   - IDX_invitations_token_hash_unique (UNIQUE) — primary hot-path lookup at redeem
 *   - IDX_invitations_purchase (BTREE) — FK index + CASCADE delete from purchases
 */
export class CreateInvitationsTable20260513150200 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "invitation_status" AS ENUM ('ISSUED', 'REDEEMED', 'EXPIRED')`);

        await queryRunner.createTable(
            new Table({
                name: 'invitations',
                columns: [
                    {
                        name: 'invitation_id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'purchase_id', type: 'integer', isNullable: false },
                    { name: 'token_hash', type: 'char', length: '64', isNullable: false },
                    { name: 'student_email', type: 'varchar', length: '255', isNullable: false },
                    { name: 'status', type: 'invitation_status', isNullable: false },
                    { name: 'expires_at', type: 'timestamptz', isNullable: false },
                    { name: 'redeemed_at', type: 'timestamptz', isNullable: true },
                    { name: 'email_sent_at', type: 'timestamptz', isNullable: true },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                ],
            }),
            true,
        );

        await queryRunner.createForeignKeys('invitations', [
            new TableForeignKey({
                name: 'FK_invitations_purchase_id',
                columnNames: ['purchase_id'],
                referencedTableName: 'purchases',
                referencedColumnNames: ['purchase_id'],
                onDelete: 'CASCADE',
                onUpdate: 'CASCADE',
            }),
        ]);

        await queryRunner.createIndices('invitations', [
            new TableIndex({ name: 'IDX_invitations_token_hash_unique', columnNames: ['token_hash'], isUnique: true }),
            new TableIndex({ name: 'IDX_invitations_purchase', columnNames: ['purchase_id'] }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('invitations', 'IDX_invitations_purchase');
        await queryRunner.dropIndex('invitations', 'IDX_invitations_token_hash_unique');
        await queryRunner.dropForeignKey('invitations', 'FK_invitations_purchase_id');
        await queryRunner.dropTable('invitations', true);
        await queryRunner.query(`DROP TYPE IF EXISTS "invitation_status"`);
    }
}
