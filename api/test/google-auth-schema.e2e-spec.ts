import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('Google-only authentication schema', () => {
  let pool: Pool;
  const userIds: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    await pool.end();
  });

  it('identifies accounts by Google subject instead of unique email', async () => {
    const email = `shared-${randomUUID()}@example.com`;
    const firstSubject = `google-${randomUUID()}`;
    const secondSubject = `google-${randomUUID()}`;

    const first = await insertGoogleUser(email, firstSubject, 'First learner');
    const second = await insertGoogleUser(
      email,
      secondSubject,
      'Second learner',
    );

    expect(first).toMatchObject({
      googleSubject: firstSubject,
      email,
      passwordHash: null,
      identityAssurance: 'google_verified',
    });
    expect(second).toMatchObject({
      googleSubject: secondSubject,
      email,
      passwordHash: null,
      identityAssurance: 'google_verified',
    });
    await expect(
      insertGoogleUser(
        `duplicate-${randomUUID()}@example.com`,
        firstSubject,
        'Duplicate subject',
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'users_google_subject_key',
    });
  });

  it('rejects a user with neither Google identity nor password credentials', async () => {
    const email = `missing-identity-${randomUUID()}@example.com`;

    await expect(
      pool.query(
        `INSERT INTO users (
           name, email, email_canonical,
           password_hash, password_algorithm, password_parameters,
           password_version, identity_assurance, email_verified_at
         ) VALUES ($1, $2, $3, NULL, NULL, NULL, NULL,
                   'google_verified', statement_timestamp())`,
        ['Missing identity', email, email],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'users_auth_shape',
    });
  });

  it('stores one-use login and account-deletion attempts with valid ownership shapes', async () => {
    const email = `attempt-owner-${randomUUID()}@example.com`;
    const owner = await insertGoogleUser(
      email,
      `google-${randomUUID()}`,
      'Attempt owner',
    );
    const sessionId = randomUUID();
    await pool.query(
      `INSERT INTO sessions (
         id, token_digest, user_id, created_at,
         absolute_expires_at, idle_expires_at, last_seen_at
       ) VALUES ($1, decode(repeat('ab', 32), 'hex'), $2,
                 statement_timestamp(),
                 statement_timestamp() + interval '1 hour',
                 statement_timestamp() + interval '30 minutes',
                 statement_timestamp())`,
      [sessionId, owner.id],
    );

    await expect(
      pool.query(
        `INSERT INTO google_auth_attempts (
           id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
           expires_at
         ) VALUES ($1, 'login', decode(repeat('11', 32), 'hex'),
                   decode(repeat('22', 32), 'hex'), decode('01', 'hex'),
                   statement_timestamp() + interval '10 minutes')`,
        [randomUUID()],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      pool.query(
        `INSERT INTO google_auth_attempts (
           id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
           user_id, session_id, expires_at
         ) VALUES ($1, 'delete_account', decode(repeat('33', 32), 'hex'),
                   decode(repeat('44', 32), 'hex'), decode('01', 'hex'),
                   $2, $3, statement_timestamp() + interval '10 minutes')`,
        [randomUUID(), owner.id, sessionId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      pool.query(
        `INSERT INTO google_auth_attempts (
           id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
           expires_at
         ) VALUES ($1, 'delete_account', decode(repeat('55', 32), 'hex'),
                   decode(repeat('66', 32), 'hex'), decode('01', 'hex'),
                   statement_timestamp() + interval '10 minutes')`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'google_auth_attempts_owner_shape',
    });

    const otherOwner = await insertGoogleUser(
      `other-attempt-owner-${randomUUID()}@example.com`,
      `google-${randomUUID()}`,
      'Other attempt owner',
    );
    const otherSessionId = randomUUID();
    await pool.query(
      `INSERT INTO sessions (
         id, token_digest, user_id, created_at,
         absolute_expires_at, idle_expires_at, last_seen_at
       ) VALUES ($1, decode(repeat('cd', 32), 'hex'), $2,
                 statement_timestamp(),
                 statement_timestamp() + interval '1 hour',
                 statement_timestamp() + interval '30 minutes',
                 statement_timestamp())`,
      [otherSessionId, otherOwner.id],
    );

    await expect(
      pool.query(
        `INSERT INTO google_auth_attempts (
           id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
           user_id, session_id, expires_at
         ) VALUES ($1, 'delete_account', decode(repeat('77', 32), 'hex'),
                   decode(repeat('88', 32), 'hex'), decode('01', 'hex'),
                   $2, $3, statement_timestamp() + interval '10 minutes')`,
        [randomUUID(), owner.id, otherSessionId],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'google_auth_attempts_session_owner_fk',
    });
  });

  async function insertGoogleUser(
    email: string,
    subject: string,
    name: string,
  ) {
    const inserted = await pool.query<{
      id: number;
      googleSubject: string;
      email: string;
      passwordHash: string | null;
      identityAssurance: string;
    }>(
      `INSERT INTO users (
         name, email, email_canonical, google_subject,
         password_hash, password_algorithm, password_parameters,
         password_version, identity_assurance, email_verified_at
       ) VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL,
                 'google_verified', statement_timestamp())
       RETURNING id, google_subject AS "googleSubject", email,
                 password_hash AS "passwordHash",
                 identity_assurance AS "identityAssurance"`,
      [name, email, email.toLowerCase(), subject],
    );
    const user = inserted.rows[0];
    if (!user) throw new Error('Google user was not inserted');
    userIds.push(user.id);
    return user;
  }
});
