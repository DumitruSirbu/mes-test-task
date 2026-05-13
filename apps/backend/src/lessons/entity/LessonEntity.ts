import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CourseEntity } from '../../courses/entity/CourseEntity';

/**
 * `lessons` table — individual content units belonging to a course.
 *
 * Uses a UUID PK (`gen_random_uuid`) so lesson URLs are non-guessable.
 * `orderIndex` determines display order within the parent course.
 * Schema is migration-driven (`synchronize: false`).
 */
@Entity({ name: 'lessons', synchronize: false })
export class LessonEntity {
    @PrimaryGeneratedColumn('uuid', { name: 'lesson_id' })
    public lessonId!: string;

    @Column({ name: 'course_id', type: 'integer' })
    public courseId!: number;

    @ManyToOne(() => CourseEntity)
    @JoinColumn({ name: 'course_id', referencedColumnName: 'courseId' })
    public course?: CourseEntity;

    @Column({ name: 'title', type: 'varchar', length: 200 })
    public title!: string;

    @Column({ name: 'body', type: 'text' })
    public body!: string;

    @Column({ name: 'order_index', type: 'integer' })
    public orderIndex!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;
}
