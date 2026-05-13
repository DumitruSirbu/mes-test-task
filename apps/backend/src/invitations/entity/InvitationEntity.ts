import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InvitationStatusEnum } from '@mes/shared';
import { PurchaseEntity } from '../../purchases/entity/PurchaseEntity';

/**
 * `invitations` table — single-use signed token a parent sends a student.
 *
 * The plaintext token is NEVER stored. The DB holds a SHA-256 hash in `token_hash`
 * (constant-time lookup); the plaintext lives only on the create response and in any
 * email link delivered to the recipient. See data-model.md "Token generation & storage".
 *
 * `email_sent_at` is created up-front (M04) so the M08 BullMQ processor needs no schema
 * change to mark delivery.
 */
@Entity({ name: 'invitations', synchronize: false })
export class InvitationEntity {
    @PrimaryGeneratedColumn({ name: 'invitation_id' })
    public invitationId!: number;

    @Column({ name: 'purchase_id', type: 'integer' })
    public purchaseId!: number;

    @ManyToOne(() => PurchaseEntity)
    @JoinColumn({ name: 'purchase_id', referencedColumnName: 'purchaseId' })
    public purchase?: PurchaseEntity;

    @Column({ name: 'token_hash', type: 'char', length: 64 })
    public tokenHash!: string;

    @Column({ name: 'student_email', type: 'varchar', length: 255 })
    public studentEmail!: string;

    @Column({ name: 'status', type: 'enum', enum: InvitationStatusEnum, enumName: 'invitation_status' })
    public status!: InvitationStatusEnum;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    public expiresAt!: Date;

    @Column({ name: 'redeemed_at', type: 'timestamptz', nullable: true })
    public redeemedAt?: Date | null;

    @Column({ name: 'email_sent_at', type: 'timestamptz', nullable: true })
    public emailSentAt?: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;

    @BeforeInsert()
    @BeforeUpdate()
    protected normaliseEmail(): void {
        if (this.studentEmail) {
            this.studentEmail = this.studentEmail.trim().toLowerCase();
        }
    }
}
