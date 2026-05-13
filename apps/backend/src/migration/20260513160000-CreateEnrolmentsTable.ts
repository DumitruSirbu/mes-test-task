import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * M05 — create `enrolments` table.
 *
 * No new ENUM type is needed (all referenced ENUMs already exist from prior migrations).
 * Indexes match data-model.md "Indexes (consolidated)":
 *   - IDX_enrolments_student_course_unique (UNIQUE) — one grant per (student, course) pair
 *   - IDX_enrolments_student (BTREE) — FK index; `GET /me/courses` hot path
 */
export class CreateEnrolmentsTable20260513160000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'enrolments',
                columns: [
                    {
                        name: 'enrolment_id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'student_user_id', type: 'integer', isNullable: false },
                    { name: 'course_id', type: 'integer', isNullable: false },
                    { name: 'source_invitation_id', type: 'integer', isNullable: true },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                ],
            }),
            true,
        );

        await queryRunner.createForeignKeys('enrolments', [
            new TableForeignKey({
                name: 'FK_enrolments_student_user_id',
                columnNames: ['student_user_id'],
                referencedTableName: 'users',
                referencedColumnNames: ['user_id'],
                onDelete: 'CASCADE',
                onUpdate: 'CASCADE',
            }),
            new TableForeignKey({
                name: 'FK_enrolments_course_id',
                columnNames: ['course_id'],
                referencedTableName: 'courses',
                referencedColumnNames: ['course_id'],
                onDelete: 'RESTRICT',
                onUpdate: 'CASCADE',
            }),
            new TableForeignKey({
                name: 'FK_enrolments_source_invitation_id',
                columnNames: ['source_invitation_id'],
                referencedTableName: 'invitations',
                referencedColumnNames: ['invitation_id'],
                onDelete: 'SET NULL',
                onUpdate: 'CASCADE',
            }),
        ]);

        await queryRunner.createIndices('enrolments', [
            new TableIndex({ name: 'IDX_enrolments_student_course_unique', columnNames: ['student_user_id', 'course_id'], isUnique: true }),
            new TableIndex({ name: 'IDX_enrolments_student', columnNames: ['student_user_id'] }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('enrolments', 'IDX_enrolments_student');
        await queryRunner.dropIndex('enrolments', 'IDX_enrolments_student_course_unique');
        await queryRunner.dropForeignKey('enrolments', 'FK_enrolments_source_invitation_id');
        await queryRunner.dropForeignKey('enrolments', 'FK_enrolments_course_id');
        await queryRunner.dropForeignKey('enrolments', 'FK_enrolments_student_user_id');
        await queryRunner.dropTable('enrolments', true);
    }
}
