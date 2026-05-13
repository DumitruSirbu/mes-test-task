import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PurchaseStatusEnum } from '@mes/shared';
import { UserEntity } from '../../users/entity/UserEntity';
import { CourseEntity } from '../../courses/entity/CourseEntity';

/**
 * `purchases` table — a parent's purchase of a course; idempotent at the API surface.
 *
 * v1 inserts directly as `COMPLETED` inside the request transaction (no async PSP yet —
 * see data-model.md state-machine note). `idempotency_key` is denormalised from
 * `idempotency_keys.key` so the per-table UNIQUE on `(parent_user_id, idempotency_key)`
 * acts as a secondary safety net.
 */
@Entity({ name: 'purchases', synchronize: false })
export class PurchaseEntity {
    @PrimaryGeneratedColumn({ name: 'purchase_id' })
    public purchaseId!: number;

    @Column({ name: 'parent_user_id', type: 'integer' })
    public parentUserId!: number;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'parent_user_id', referencedColumnName: 'userId' })
    public parent?: UserEntity;

    @Column({ name: 'course_id', type: 'integer' })
    public courseId!: number;

    @ManyToOne(() => CourseEntity)
    @JoinColumn({ name: 'course_id', referencedColumnName: 'courseId' })
    public course?: CourseEntity;

    @Column({ name: 'status', type: 'enum', enum: PurchaseStatusEnum, enumName: 'purchase_status' })
    public status!: PurchaseStatusEnum;

    @Column({ name: 'amount_pence', type: 'integer' })
    public amountPence!: number;

    @Column({ name: 'idempotency_key', type: 'varchar', length: 64 })
    public idempotencyKey!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    public updatedAt!: Date;
}
