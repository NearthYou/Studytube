import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  executeUserDataReset,
  type VerifiedResetBackupProof,
} from '../scripts/user-data-reset';
import { buildUserDataResetPlan } from '../src/maintenance/user-data-reset.plan';

const DATABASE_URL = process.env.USER_DATA_RESET_E2E_DATABASE_URL ?? '';
const describeReset =
  process.env.ALLOW_USER_DATA_RESET_E2E === 'true' ? describe : describe.skip;

describeReset('whole application data reset (isolated e2e)', () => {
  let pool: Pool;

  beforeAll(() => {
    if (!isIsolatedResetDatabase(DATABASE_URL)) {
      throw new Error('USER_DATA_RESET_E2E_DATABASE_UNSAFE');
    }
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('empties every reset table while preserving operational configuration', async () => {
    const client = await pool.connect();
    try {
      const email = `reset-${randomUUID()}@example.com`;
      const user = await client.query<{ id: number }>(
        `INSERT INTO users (
           name, email, email_canonical, google_subject,
           password_hash, password_algorithm, password_parameters,
           password_version, identity_assurance, email_verified_at
         ) VALUES ('Reset learner', $1, $1, $2, NULL, NULL, NULL, NULL,
                   'google_verified', statement_timestamp())
         RETURNING id`,
        [email, `google-${randomUUID()}`],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error('Expected reset fixture user');
      await client.query(
        `INSERT INTO sessions (
           id, token_digest, user_id, created_at,
           absolute_expires_at, idle_expires_at, last_seen_at
         ) VALUES ($1, $2, $3, statement_timestamp(),
                   statement_timestamp() + interval '1 day',
                   statement_timestamp() + interval '1 day',
                   statement_timestamp())`,
        [
          randomUUID(),
          createHash('sha256').update(randomUUID(), 'utf8').digest(),
          userId,
        ],
      );
      await client.query(
        `INSERT INTO courses (
           owner_id, title, description, visibility, status
         ) VALUES ($1, 'Reset Course', '', 'private', 'draft')`,
        [userId],
      );

      const before = await buildUserDataResetPlan(client);
      expect(before.totalResetRows).toBeGreaterThanOrEqual(3);
      const proof: VerifiedResetBackupProof = {
        schemaVersion: 'studytube.user-data-reset-backup.v1',
        runId: 'reset-20260831T170000Z',
        databaseName: before.databaseName,
        manifestSha256: before.manifestSha256,
        planSha256: before.planSha256,
        dumpSha256: 'd'.repeat(64),
        s3Bucket: 'studytube-private-backup',
        s3ObjectKey: 'user-data-reset/reset-20260831T170000Z/postgres.dump',
        createdAt: '2026-08-31T17:00:00.000Z',
        deleteAfter: '2026-09-07T17:00:00.000Z',
        restoreVerified: true,
      };

      await expect(
        executeUserDataReset({ client, proof }),
      ).resolves.toMatchObject({
        status: 'reset',
        totalResetRowsAfter: 0,
        manifestSha256: before.manifestSha256,
        planSha256Before: before.planSha256,
        preservedFingerprintSha256: before.preservedFingerprintSha256,
      });
      const after = await buildUserDataResetPlan(client);
      expect(after.totalResetRows).toBe(0);
      expect(after.preservedFingerprintSha256).toBe(
        before.preservedFingerprintSha256,
      );
    } finally {
      client.release();
    }
  });
});

function isIsolatedResetDatabase(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'postgresql:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.port === '55432' &&
      url.pathname === '/app_reset_test'
    );
  } catch {
    return false;
  }
}
