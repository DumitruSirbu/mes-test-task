import { MigrationInterface, QueryRunner } from 'typeorm';
import * as argon2 from 'argon2';
import { ARGON2_MEMORY_COST, ARGON2_PARALLELISM, ARGON2_TIME_COST } from '../auth/const/AuthConsts';

/**
 * Seeds the bootstrap ADMIN user. Idempotent: if the email already exists, this migration
 * is a no-op for that row.
 *
 * Default credentials are dev-only and MUST be rotated in any deployed environment.
 * Override via env vars `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before running migrations.
 *
 * In production (NODE_ENV !== 'development' | 'test'), both vars are mandatory — the
 * migration will refuse to run if either is absent to prevent shipping default credentials.
 *
 * Empty-string values (e.g. `SEED_ADMIN_EMAIL=""`) are treated as unset in all environments.
 */
export class SeedAdminUser20260513140100 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const env = process.env.NODE_ENV ?? 'production';
        const isProd = env !== 'development' && env !== 'test';

        // Treat whitespace-only values as absent so a misconfigured `VAR=""` is caught.
        const emailRaw = process.env.SEED_ADMIN_EMAIL?.trim() ?? '';
        const passwordRaw = process.env.SEED_ADMIN_PASSWORD?.trim() ?? '';

        const email = emailRaw !== '' ? emailRaw : undefined;
        const password = passwordRaw !== '' ? passwordRaw : undefined;

        if (isProd) {
            if (!email) {
                throw new Error('SEED_ADMIN_EMAIL is required in production — refusing to seed admin user with a default email.');
            }

            if (!password) {
                throw new Error('SEED_ADMIN_PASSWORD is required in production — refusing to seed admin user with a default password.');
            }
        }

        const resolvedEmail = (email ?? 'admin@mes.test').toLowerCase();
        const resolvedPassword = password ?? 'changeme-admin-12345';

        // queryRunner.query returns `any[]` at the SQL boundary; we assert the shape we need.
        const existing = (await queryRunner.query(`SELECT 1 FROM "users" WHERE email = $1 LIMIT 1`, [resolvedEmail])) as { length: number }[];

        if (existing.length > 0) {
            return;
        }

        const passwordHash = await argon2.hash(resolvedPassword, {
            type: argon2.argon2id,
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        });

        await queryRunner.query(`INSERT INTO "users" (email, password_hash, role) VALUES ($1, $2, 'ADMIN')`, [resolvedEmail, passwordHash]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const emailRaw = process.env.SEED_ADMIN_EMAIL?.trim() ?? '';
        const email = emailRaw !== '' ? emailRaw.toLowerCase() : 'admin@mes.test';
        await queryRunner.query(`DELETE FROM "users" WHERE email = $1 AND role = 'ADMIN'`, [email]);
    }
}
