import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { CourseSubjectEnum } from '@mes/shared';

/**
 * `courses` table — catalog of purchasable courses.
 *
 * See docs/architecture/data-model.md for column rationale and the index inventory.
 * Schema is migration-driven (`synchronize: false`). The `enumName: 'course_subject'`
 * binds this column to the PostgreSQL native ENUM created in `CreateCoursesTable`.
 *
 * Price is stored in pence (integer) — the source of truth for money in v1. The TS
 * property is `pricePence` to keep the unit explicit at every callsite.
 */
@Entity({ name: 'courses', synchronize: false })
export class CourseEntity {
    @PrimaryGeneratedColumn({ name: 'course_id' })
    public courseId!: number;

    @Column({ name: 'subject', type: 'enum', enum: CourseSubjectEnum, enumName: 'course_subject' })
    public subject!: CourseSubjectEnum;

    @Column({ name: 'year_from', type: 'smallint' })
    public yearFrom!: number;

    @Column({ name: 'year_to', type: 'smallint' })
    public yearTo!: number;

    @Column({ name: 'title', type: 'varchar', length: 120 })
    public title!: string;

    @Column({ name: 'price_pence', type: 'integer' })
    public pricePence!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;
}
