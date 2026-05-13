import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from '../../users/entity/UserEntity';
import { CourseEntity } from '../../courses/entity/CourseEntity';
import { InvitationEntity } from '../../invitations/entity/InvitationEntity';

/**
 * `enrolments` table — grant linking a student to a course.
 *
 * Created atomically during invitation redemption (M05). `sourceInvitationId` is
 * nullable and set to NULL on invitation deletion (audit trail only — see FK policy
 * in data-model.md).
 *
 * `IDX_enrolments_student_course_unique` enforces the one-grant-per-pair invariant;
 * a race-condition double-insert will raise PG error 23505 which the repository
 * translates to `EnrolmentAlreadyExistsError`.
 */
@Entity({ name: 'enrolments', synchronize: false })
export class EnrolmentEntity {
    @PrimaryGeneratedColumn({ name: 'enrolment_id' })
    public enrolmentId!: number;

    @Column({ name: 'student_user_id', type: 'integer' })
    public studentUserId!: number;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'student_user_id', referencedColumnName: 'userId' })
    public student?: UserEntity;

    @Column({ name: 'course_id', type: 'integer' })
    public courseId!: number;

    @ManyToOne(() => CourseEntity)
    @JoinColumn({ name: 'course_id', referencedColumnName: 'courseId' })
    public course?: CourseEntity;

    @Column({ name: 'source_invitation_id', type: 'integer', nullable: true })
    public sourceInvitationId?: number | null;

    @ManyToOne(() => InvitationEntity)
    @JoinColumn({ name: 'source_invitation_id', referencedColumnName: 'invitationId' })
    public sourceInvitation?: InvitationEntity | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;
}
