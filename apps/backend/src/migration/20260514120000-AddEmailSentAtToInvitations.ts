import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M08 — guard migration that ensures `email_sent_at TIMESTAMPTZ NULL` exists on
 * the `invitations` table.
 *
 * The column was already created in `20260513150200-CreateInvitationsTable.ts`
 * (where it was placed up-front to avoid a breaking schema change later).
 * This migration is an `ADD COLUMN IF NOT EXISTS` no-op so fresh deployments
 * running only a subset of migrations and environments where the column was
 * added via a different path are both safe.
 *
 * `down()` is intentionally a no-op: dropping the column here would conflict
 * with `CreateInvitationsTable.down()` which drops the whole table.
 */
export class AddEmailSentAtToInvitations20260514120000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE invitations
            ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ NULL
        `);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Intentional no-op: the column is owned by CreateInvitationsTable.
        // Dropping it here would conflict with that migration's down() path.
        return;
    }
}
