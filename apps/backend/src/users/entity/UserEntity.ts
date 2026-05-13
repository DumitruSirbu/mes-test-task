import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRoleEnum } from '@mes/shared';

/**
 * `users` table — auth identity for parents, students, and admins.
 *
 * See docs/architecture/data-model.md for column rationale and the FK / index inventory.
 * Schema is migration-driven (`synchronize: false`); the `enumName: 'user_role'` mapping
 * binds this column to the PostgreSQL native ENUM created in `CreateUsersTable`.
 */
@Entity({ name: 'users', synchronize: false })
export class UserEntity {
    @PrimaryGeneratedColumn({ name: 'user_id' })
    public userId!: number;

    @Column({ name: 'email', type: 'varchar', length: 255 })
    public email!: string;

    @Column({ name: 'password_hash', type: 'varchar', length: 255 })
    public passwordHash!: string;

    @Column({ name: 'role', type: 'enum', enum: UserRoleEnum, enumName: 'user_role' })
    public role!: UserRoleEnum;

    @Column({ name: 'first_name', type: 'varchar', length: 80, nullable: true })
    public firstName?: string | null;

    @Column({ name: 'last_name', type: 'varchar', length: 80, nullable: true })
    public lastName?: string | null;

    @Column({ name: 'date_of_birth', type: 'date', nullable: true })
    public dateOfBirth?: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    public createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    public updatedAt!: Date;

    @BeforeInsert()
    @BeforeUpdate()
    protected normaliseEmail(): void {
        if (this.email) {
            this.email = this.email.trim().toLowerCase();
        }
    }
}
