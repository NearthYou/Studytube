import type { Pool, PoolClient } from 'pg';
import { AuthRepositoryUnavailableError } from '../auth.repository';
import { normalizePreferences } from '../../database-board.mapper';
import type {
  CommitGoogleLoginCommand,
  CommitGoogleLoginResult,
  ConsumeGoogleAuthAttemptResult,
  CreateGoogleAuthAttemptCommand,
  GoogleAuthAttemptPurpose,
  GoogleAuthRepository,
  MarkGoogleReauthenticatedCommand,
} from './google-auth.repository';

type GoogleAuthSqlPool = Pick<Pool, 'query' | 'connect'>;

type StoredAttemptRow = {
  id: string;
  purpose: GoogleAuthAttemptPurpose;
  nonceDigest: Buffer;
  encryptedCodeVerifier: Buffer;
  userId: number | null;
  sessionId: string | null;
  returnPath: string | null;
};

type GoogleUserRow = {
  id: number;
  name: string;
  email: string;
  preferences: unknown;
  createdAt: Date | string;
};

export class PostgresGoogleAuthRepository implements GoogleAuthRepository {
  constructor(private readonly pool: GoogleAuthSqlPool) {}

  async createGoogleAuthAttempt(
    command: CreateGoogleAuthAttemptCommand,
  ): Promise<void> {
    try {
      await this.pool.query(
        `
          INSERT INTO google_auth_attempts (
            id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
            user_id, session_id, return_path, created_at, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          command.id,
          command.purpose,
          command.stateDigest,
          command.nonceDigest,
          command.encryptedCodeVerifier,
          command.userId ?? null,
          command.sessionId ?? null,
          command.returnPath,
          command.createdAt,
          command.expiresAt,
        ],
      );
    } catch {
      throw new AuthRepositoryUnavailableError();
    }
  }

  async consumeGoogleAuthAttempt(
    stateDigest: Buffer,
    consumedAt: Date,
  ): Promise<ConsumeGoogleAuthAttemptResult> {
    try {
      const result = await this.pool.query<StoredAttemptRow>(
        `
          WITH candidate AS MATERIALIZED (
            SELECT id
            FROM google_auth_attempts
            WHERE state_digest = $1
              AND consumed_at IS NULL
              AND expires_at > $2
            FOR UPDATE
          ), consumed AS (
            UPDATE google_auth_attempts AS attempt
            SET consumed_at = $2
            FROM candidate
            WHERE attempt.id = candidate.id
              AND attempt.consumed_at IS NULL
            RETURNING attempt.id,
                      attempt.purpose,
                      attempt.nonce_digest AS "nonceDigest",
                      attempt.encrypted_code_verifier AS "encryptedCodeVerifier",
                      attempt.user_id AS "userId",
                      attempt.session_id AS "sessionId",
                      attempt.return_path AS "returnPath"
          )
          SELECT * FROM consumed
        `,
        [stateDigest, consumedAt],
      );
      const row = result.rows[0];
      if (!row) return { status: 'invalid' };
      return {
        status: 'consumed',
        attempt: {
          id: row.id,
          purpose: row.purpose,
          nonceDigest: row.nonceDigest,
          encryptedCodeVerifier: row.encryptedCodeVerifier,
          ...(row.userId === null ? {} : { userId: row.userId }),
          ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
          returnPath: row.returnPath || '/',
        },
      };
    } catch {
      throw new AuthRepositoryUnavailableError();
    }
  }

  async commitGoogleLogin(
    command: CommitGoogleLoginCommand,
  ): Promise<CommitGoogleLoginResult> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new AuthRepositoryUnavailableError();
    }
    let transactionOpen = false;
    const rollback = async () => {
      if (!transactionOpen) return;
      await client.query('ROLLBACK');
      transactionOpen = false;
    };

    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const inserted = await client.query<GoogleUserRow>(
        `
          INSERT INTO users (
            name, email, email_canonical, google_subject,
            password_hash, password_algorithm, password_parameters,
            password_version, identity_assurance, email_verified_at,
            profile_image_url, last_login_at
          )
          VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL,
                  'google_verified', $5, $6, $5)
          ON CONFLICT (google_subject) DO NOTHING
          RETURNING id, name, email, preferences, created_at AS "createdAt"
        `,
        [
          command.name,
          command.email,
          command.emailCanonical,
          command.googleSubject,
          command.authenticatedAt,
          command.profileImageUrl,
        ],
      );
      let user = inserted.rows[0];
      const newUser = user !== undefined;
      if (!user) {
        const updated = await client.query<GoogleUserRow>(
          `
            UPDATE users
            SET email = $2,
                email_canonical = $3,
                email_verified_at = $4,
                profile_image_url = $5,
                last_login_at = $4
            WHERE google_subject = $1
            RETURNING id, name, email, preferences, created_at AS "createdAt"
          `,
          [
            command.googleSubject,
            command.email,
            command.emailCanonical,
            command.authenticatedAt,
            command.profileImageUrl,
          ],
        );
        user = updated.rows[0];
      }
      if (!user) {
        await rollback();
        return { status: 'invalid' };
      }

      await client.query(
        `
          INSERT INTO sessions (
            id, token_digest, user_id, created_at,
            absolute_expires_at, idle_expires_at, last_seen_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $4)
        `,
        [
          command.sessionId,
          command.sessionDigest,
          user.id,
          command.sessionCreatedAt,
          command.sessionAbsoluteExpiresAt,
          command.sessionIdleExpiresAt,
        ],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        status: 'committed',
        newUser,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          preferences: normalizePreferences(user.preferences),
          createdAt: new Date(user.createdAt).toISOString(),
        },
      };
    } catch {
      try {
        await rollback();
      } catch {
        throw new AuthRepositoryUnavailableError();
      }
      throw new AuthRepositoryUnavailableError();
    } finally {
      client.release();
    }
  }

  async markGoogleReauthenticated(
    command: MarkGoogleReauthenticatedCommand,
  ): Promise<boolean> {
    try {
      const result = await this.pool.query<{ id: string }>(
        `
          UPDATE sessions AS session
          SET google_reauthenticated_at = $4
          FROM users AS user
          WHERE session.user_id = $1
            AND session.id = $2
            AND user.id = session.user_id
            AND user.google_subject = $3
            AND session.revoked_at IS NULL
            AND session.absolute_expires_at > $4
            AND session.idle_expires_at > $4
          RETURNING session.id
        `,
        [
          command.userId,
          command.sessionId,
          command.googleSubject,
          command.reauthenticatedAt,
        ],
      );
      return result.rows[0] !== undefined;
    } catch {
      throw new AuthRepositoryUnavailableError();
    }
  }
}
