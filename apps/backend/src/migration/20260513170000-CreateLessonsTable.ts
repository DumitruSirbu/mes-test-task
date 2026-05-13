import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * M06 — create `lessons` table and seed 3–5 lessons per seeded course.
 *
 * `lesson_id` is a UUID PK (gen_random_uuid) — lessons are shareable by URL and benefit
 * from non-guessable IDs unlike the small numeric catalog tables.
 *
 * Seed rows use `ON CONFLICT (course_id, order_index) DO NOTHING` so re-running
 * `migration:run` on a non-empty DB is idempotent.
 *
 * Course IDs come from the stable catalog seeded in CreateCoursesTable; we use
 * a sub-select so we do not hard-code auto-increment values.
 */
export class CreateLessonsTable20260513170000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'lessons',
                columns: [
                    {
                        name: 'lesson_id',
                        type: 'uuid',
                        isPrimary: true,
                        default: 'gen_random_uuid()',
                    },
                    { name: 'course_id', type: 'integer', isNullable: false },
                    { name: 'title', type: 'varchar', length: '200', isNullable: false },
                    { name: 'body', type: 'text', isNullable: false },
                    { name: 'order_index', type: 'integer', isNullable: false },
                    { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
                ],
            }),
            true,
        );

        await queryRunner.createForeignKeys('lessons', [
            new TableForeignKey({
                name: 'FK_lessons_course_id',
                columnNames: ['course_id'],
                referencedTableName: 'courses',
                referencedColumnNames: ['course_id'],
                onDelete: 'CASCADE',
                onUpdate: 'CASCADE',
            }),
        ]);

        await queryRunner.createIndices('lessons', [
            new TableIndex({
                name: 'IDX_lessons_course_order_unique',
                columnNames: ['course_id', 'order_index'],
                isUnique: true,
            }),
            new TableIndex({
                name: 'IDX_lessons_course_id',
                columnNames: ['course_id'],
            }),
        ]);

        await this.seedLessons(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('lessons', 'IDX_lessons_course_id');
        await queryRunner.dropIndex('lessons', 'IDX_lessons_course_order_unique');
        await queryRunner.dropForeignKey('lessons', 'FK_lessons_course_id');
        await queryRunner.dropTable('lessons', true);
    }

    private async seedLessons(queryRunner: QueryRunner): Promise<void> {
        const SUBJECT_MATHS = 'MATHS';
        const SUBJECT_ENGLISH = 'ENGLISH';
        const SUBJECT_SCIENCE = 'SCIENCE';

        const mathsY7Lessons = [
            {
                title: 'Introduction to Algebra',
                body: 'Learn the basics of algebra: variables, expressions, and simple equations. We will explore how letters can represent unknown values and how to manipulate expressions.',
                orderIndex: 1,
            },
            {
                title: 'Solving Linear Equations',
                body: 'Step-by-step techniques for solving one-variable linear equations. Covers inverse operations, balancing both sides, and checking solutions.',
                orderIndex: 2,
            },
            {
                title: 'Geometry: Angles and Triangles',
                body: 'Properties of angles, types of triangles, and the angle-sum theorem. We will calculate missing angles using the rules for supplementary, complementary, and vertically opposite angles.',
                orderIndex: 3,
            },
            {
                title: 'Fractions, Decimals and Percentages',
                body: 'Converting between fractions, decimals, and percentages. Practical examples include calculating discounts, tips, and proportional quantities.',
                orderIndex: 4,
            },
            {
                title: 'Introduction to Statistics',
                body: 'Collecting and organising data, calculating mean, median, mode, and range. We will interpret bar charts, pie charts, and frequency tables.',
                orderIndex: 5,
            },
        ];

        const englishY7Lessons = [
            {
                title: 'Reading Comprehension Strategies',
                body: 'Techniques for understanding unseen prose: skimming, scanning, inference, and deduction. Practise retrieving and interpreting information from fiction and non-fiction.',
                orderIndex: 1,
            },
            {
                title: 'Parts of Speech and Sentence Structure',
                body: 'Nouns, verbs, adjectives, adverbs, prepositions, and conjunctions. Understand simple, compound, and complex sentences to build writing accuracy.',
                orderIndex: 2,
            },
            {
                title: 'Creative Writing: Narrative Techniques',
                body: "Crafting engaging stories using show-don't-tell, vivid description, dialogue, and varied sentence rhythm. We examine extracts from published authors as models.",
                orderIndex: 3,
            },
            {
                title: 'Poetry: Form and Language',
                body: 'Exploring rhyme, rhythm, imagery, and figurative language in poetry. Analyse a range of poems and write your own using specific structural forms.',
                orderIndex: 4,
            },
        ];

        const scienceY7Lessons = [
            {
                title: 'Cells: The Building Blocks of Life',
                body: 'Structure and function of plant and animal cells. We compare organelles, learn how to use a light microscope, and examine prepared slides.',
                orderIndex: 1,
            },
            {
                title: 'Forces and Motion',
                body: "Contact and non-contact forces, Newton's laws, speed calculations, and distance–time graphs. Practical investigations using ramps and ticker-tape timers.",
                orderIndex: 2,
            },
            {
                title: 'Atoms, Elements and Compounds',
                body: 'The periodic table, atomic structure, and how elements combine to form compounds. Introduction to chemical symbols, formulae, and word equations.',
                orderIndex: 3,
            },
        ];

        await this.insertLessonsForCourse(queryRunner, SUBJECT_MATHS, 7, 7, mathsY7Lessons);
        await this.insertLessonsForCourse(queryRunner, SUBJECT_ENGLISH, 7, 7, englishY7Lessons);
        await this.insertLessonsForCourse(queryRunner, SUBJECT_SCIENCE, 7, 7, scienceY7Lessons);
    }

    private async insertLessonsForCourse(
        queryRunner: QueryRunner,
        subject: string,
        yearFrom: number,
        yearTo: number,
        lessons: Array<{ title: string; body: string; orderIndex: number }>,
    ): Promise<void> {
        for (const lesson of lessons) {
            await queryRunner.query(
                `INSERT INTO "lessons" (course_id, title, body, order_index)
                 SELECT c.course_id, $1, $2, $3
                 FROM "courses" c
                 WHERE c.subject = $4 AND c.year_from = $5 AND c.year_to = $6
                 ON CONFLICT (course_id, order_index) DO NOTHING`,
                [lesson.title, lesson.body, lesson.orderIndex, subject, yearFrom, yearTo],
            );
        }
    }
}
