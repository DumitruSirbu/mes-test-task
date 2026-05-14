import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from '../../users/entity/UserEntity';

/**
 * Persistence-only mapping for the `refresh_tokens` table (ADR 0007 §3).
 *
 * Raw tokens are never stored — only the SHA-256 hex hash. `ip` is stored as a
 * string here because TypeORM has no native INET JS type; it reads/writes as a
 * PostgreSQL INET column (specified in the migration) via string coercion.
 *
 * `replacedById` is a self-referential FK: after rotation, the old row carries
 * the successor's id so the grace-window path can fetch the successor in one
 * additional SELECT without a join.
 *
 * `synchronize: false` — all schema changes go through migrations only.
 */
@Entity({ name: 'refresh_tokens', synchronize: false })
export class RefreshTokenEntity {
    // bigint PK: if row count ever approaches Number.MAX_SAFE_INTEGER (~9e15), swap to a bigint string with a TypeORM value transformer.
    @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
    public id!: number;

    @Column({ name: 'user_id', type: 'bigint', nullable: false })
    public userId!: number;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
    public user!: UserEntity;

    @Column({ name: 'family_id', type: 'uuid', nullable: false })
    public familyId!: string;

    @Column({ name: 'token_hash', type: 'char', length: 64, nullable: false, unique: true })
    public tokenHash!: string;

    @Column({ name: 'issued_at', type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    public issuedAt!: Date;

    @Column({ name: 'expires_at', type: 'timestamptz', nullable: false })
    public expiresAt!: Date;

    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
    public revokedAt!: Date | null;

    @Column({ name: 'replaced_by_id', type: 'bigint', nullable: true })
    public replacedById!: number | null;

    @Column({ name: 'user_agent', type: 'text', nullable: true })
    public userAgent!: string | null;

    @Column({ name: 'ip', type: 'inet', nullable: true })
    public ip!: string | null;
}
