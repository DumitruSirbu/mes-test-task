import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * M03 — create `users` table and the `user_role` native PostgreSQL ENUM.
 *
 * Mirrors `UserRoleEnum` in `packages/shared`. The ENUM is declared explicitly via raw
 * SQL (rather than letting TypeORM auto-name it `users_role_enum`) so the type name
 * matches the manual catalogue in `docs/architecture/data-model.md` and any future
 * column reusing this enum picks up the same type.
 */
export class CreateUsersTable20260513140000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('PARENT', 'STUDENT', 'ADMIN')`);

        await queryRunner.createTable(
            new Table({
                name: 'users',
                columns: [
                    {
                        name: 'user_id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'email', type: 'varchar', length: '255', isNullable: false },
                    { name: 'password_hash', type: 'varchar', length: '255', isNullable: false },
                    { name: 'role', type: 'user_role', isNullable: false },
                    { name: 'first_name', type: 'varchar', length: '80', isNullable: true },
                    { name: 'last_name', type: 'varchar', length: '80', isNullable: true },
                    { name: 'date_of_birth', type: 'date', isNullable: true },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                ],
            }),
            true,
        );

        await queryRunner.createIndices('users', [
            new TableIndex({ name: 'IDX_users_email_unique', columnNames: ['email'], isUnique: true }),
            new TableIndex({ name: 'IDX_users_role', columnNames: ['role'] }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('users', 'IDX_users_role');
        await queryRunner.dropIndex('users', 'IDX_users_email_unique');
        await queryRunner.dropTable('users', true);
        await queryRunner.query(`DROP TYPE IF EXISTS "user_role"`);
    }
}
