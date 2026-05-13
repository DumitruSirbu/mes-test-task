import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * M04 — create `courses` table and the `course_subject` native PostgreSQL ENUM.
 *
 * Also seeds the catalog per the brief:
 *   - Maths Y5..Y13
 *   - English Y5..Y13
 *   - Science Y5..Y11
 *   - All at £199 (19900 pence).
 *
 * Seed values are stable across environments — see `data-model.md` seed table.
 * The seed runs inside this migration so a fresh `migration:run` lands a working catalog.
 */
const PRICE_PENCE = 19900;

interface ISeedRow {
    subject: 'MATHS' | 'ENGLISH' | 'SCIENCE';
    yearFrom: number;
    yearTo: number;
}

const buildYearRows = (subject: ISeedRow['subject'], yearStart: number, yearEnd: number): ISeedRow[] => {
    const rows: ISeedRow[] = [];

    for (let year = yearStart; year <= yearEnd; year++) {
        rows.push({ subject, yearFrom: year, yearTo: year });
    }

    return rows;
};

const titleForRow = (row: ISeedRow): string => {
    const subjectTitle = row.subject.charAt(0) + row.subject.slice(1).toLowerCase();

    return `${subjectTitle} Year ${row.yearFrom}`;
};

export class CreateCoursesTable20260513150000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "course_subject" AS ENUM ('MATHS', 'ENGLISH', 'SCIENCE')`);

        await queryRunner.createTable(
            new Table({
                name: 'courses',
                columns: [
                    {
                        name: 'course_id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'subject', type: 'course_subject', isNullable: false },
                    { name: 'year_from', type: 'smallint', isNullable: false },
                    { name: 'year_to', type: 'smallint', isNullable: false },
                    { name: 'title', type: 'varchar', length: '120', isNullable: false },
                    { name: 'price_pence', type: 'integer', isNullable: false },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
                ],
                checks: [{ name: 'CHK_courses_price_pence_non_negative', expression: '"price_pence" >= 0' }],
            }),
            true,
        );

        await queryRunner.createIndices('courses', [
            new TableIndex({
                name: 'IDX_courses_subject_year_unique',
                columnNames: ['subject', 'year_from', 'year_to'],
                isUnique: true,
            }),
        ]);

        const seedRows: ISeedRow[] = [...buildYearRows('MATHS', 5, 13), ...buildYearRows('ENGLISH', 5, 13), ...buildYearRows('SCIENCE', 5, 11)];

        for (const row of seedRows) {
            await queryRunner.query(
                // Use the column tuple as the conflict target. A unique *index* is not a
                // named constraint in Postgres, so `ON CONFLICT ON CONSTRAINT ...` would error
                // with "constraint does not exist" — the column-tuple form binds to the same
                // unique index without needing a constraint object.
                `INSERT INTO "courses" (subject, year_from, year_to, title, price_pence)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (subject, year_from, year_to) DO NOTHING`,
                [row.subject, row.yearFrom, row.yearTo, titleForRow(row), PRICE_PENCE],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('courses', 'IDX_courses_subject_year_unique');
        await queryRunner.dropTable('courses', true);
        await queryRunner.query(`DROP TYPE IF EXISTS "course_subject"`);
    }
}
