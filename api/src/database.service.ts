import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Pool, PoolClient, type QueryConfig } from 'pg';
import type {
  CompleteRegistrationCommand,
  CompleteRegistrationResult,
  ConsumeVerificationCommand,
  ConsumeVerificationResult,
  FindEnrollmentCandidateCommand,
  FindEnrollmentCandidateResult,
  PendingRegistrationCommand,
  PendingRegistrationResult,
  RateLimitCommand,
  RateLimitResult,
} from './auth/auth.types';
import {
  iso,
  normalizeComment,
  normalizeFeedback,
  normalizeTagNames,
  normalizeVideoAsset,
  publicUser,
  vectorLiteral,
  type PostRow,
  type UserRow,
  type VideoAssetRow,
} from './database-board.mapper';
import {
  BoardRepository,
  Comment,
  CreatePostInput,
  LearningPreferences,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  Session,
  StudyPost,
  UpdatePlaylistInput,
  UpdatePostInput,
  User,
} from './study-board.types';
import type {
  CreateVideoAssetInput,
  UpdateVideoAssetInput,
  VideoAsset,
} from './video-asset.types';

@Injectable()
export class DatabaseService
  implements BoardRepository, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly databaseInitAttempts: number;
  private readonly databaseInitRetryDelayMs: number;
  private readonly databaseQueryTimeoutMs: number;

  constructor(configService: ConfigService) {
    this.databaseInitAttempts = this.positiveInteger(
      configService.get<string>('DB_INIT_ATTEMPTS'),
      15,
    );
    this.databaseInitRetryDelayMs = this.nonNegativeInteger(
      configService.get<string>('DB_INIT_RETRY_DELAY_MS'),
      1000,
    );
    this.databaseQueryTimeoutMs = this.positiveInteger(
      configService.get<string>('DB_QUERY_TIMEOUT_MS'),
      3000,
    );
    this.pool = new Pool({
      connectionString:
        configService.get<string>('DATABASE_URL') ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
  }

  async onModuleInit() {
    await this.initializeDatabaseWithRetry();
  }

  private async initializeDatabaseWithRetry() {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.databaseInitAttempts; attempt += 1) {
      try {
        await this.probeDatabase();
        return;
      } catch (error) {
        lastError = error;

        if (attempt >= this.databaseInitAttempts) {
          break;
        }

        this.logger.warn(
          `PostgreSQL not ready, retrying database initialization (${attempt}/${this.databaseInitAttempts}): ${this.toErrorMessage(
            error,
          )}`,
        );
        await this.wait(this.databaseInitRetryDelayMs);
      }
    }

    throw lastError;
  }

  private probeDatabase() {
    const query: QueryConfig & { query_timeout: number } = {
      text: 'SELECT 1 AS ok',
      query_timeout: this.databaseQueryTimeoutMs,
    };

    return this.pool.query<{ ok: number }>(query);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async health() {
    try {
      const result = await this.probeDatabase();

      return {
        service: 'api',
        status: result.rows[0]?.ok === 1 ? 'ok' : 'unknown',
        ready: result.rows[0]?.ok === 1,
        database: 'postgresql + pgvector',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `PostgreSQL health probe failed: ${this.toErrorMessage(error)}`,
      );

      return {
        service: 'api',
        status: 'unavailable',
        ready: false,
        database: 'postgresql + pgvector',
        error: 'database_unavailable',
        timestamp: new Date().toISOString(),
      };
    }
  }

  async consumeRateLimit(command: RateLimitCommand): Promise<RateLimitResult> {
    try {
      const result = await this.pool.query<{
        allowed: boolean;
        remaining: number;
        retryAfterSeconds: number;
      }>(
        `
          WITH rate_window AS (
            SELECT to_timestamp(
              floor(
                extract(epoch FROM statement_timestamp()) /
                $3::double precision
              ) * $3::double precision
            ) AS window_start
          ), consumed AS (
            INSERT INTO auth_rate_limits (
              action, subject_digest, window_start, attempts, expires_at
            )
            SELECT $1, $2, window_start, 1,
                   window_start + make_interval(secs => $3::double precision)
            FROM rate_window
            ON CONFLICT (action, subject_digest, window_start)
            DO UPDATE SET
              attempts = auth_rate_limits.attempts + 1,
              expires_at = EXCLUDED.expires_at
            RETURNING attempts, expires_at
          )
          SELECT attempts <= $4 AS allowed,
                 greatest($4 - attempts, 0)::integer AS remaining,
                 greatest(
                   1,
                   ceil(
                     extract(epoch FROM (expires_at - statement_timestamp()))
                   )::integer
                 ) AS "retryAfterSeconds"
          FROM consumed
        `,
        [
          command.action,
          command.subjectDigest,
          command.windowSeconds,
          command.maxAttempts,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw this.authPersistenceError();
      }
      return row.allowed
        ? { allowed: true, remaining: Number(row.remaining) }
        : {
            allowed: false,
            retryAfterSeconds: Number(row.retryAfterSeconds),
          };
    } catch {
      throw this.authPersistenceError();
    }
  }

  async createPendingRegistration(
    command: PendingRegistrationCommand,
  ): Promise<PendingRegistrationResult> {
    const client = await this.connectAuthClient();
    let transactionOpen = false;
    const rollback = async () => {
      if (!transactionOpen) {
        return;
      }
      await client.query('ROLLBACK');
      transactionOpen = false;
    };

    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const eligibility = await client.query<{
        userExists: boolean;
        pendingExists: boolean;
      }>(
        `
          SELECT EXISTS (
                   SELECT 1
                   FROM users
                   WHERE email_canonical = $1
                 ) AS "userExists",
                 EXISTS (
                   SELECT 1
                   FROM pending_registrations
                   WHERE email_canonical = $1
                     AND completed_at IS NULL
                     AND verification_expires_at > statement_timestamp()
                 ) AS "pendingExists"
        `,
        [command.emailCanonical],
      );
      const state = eligibility.rows[0];
      if (!state || state.userExists || state.pendingExists) {
        await client.query('COMMIT');
        transactionOpen = false;
        return { status: 'accepted' };
      }

      await client.query(
        `
          INSERT INTO pending_registrations (
            id, email, email_canonical, key_version,
            verification_digest, created_at, verification_expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          command.pendingRegistrationId,
          command.recipient,
          command.emailCanonical,
          command.keyVersion,
          command.verificationDigest,
          command.createdAt,
          command.verificationExpiresAt,
        ],
      );
      await client.query(
        `
          INSERT INTO verification_email_outbox (
            id, pending_registration_id, recipient, idempotency_key,
            sender, public_origin, template_version, locale, subject,
            payload_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          command.outbox.id,
          command.pendingRegistrationId,
          command.recipient,
          command.outbox.idempotencyKey,
          command.outbox.sender,
          command.outbox.publicOrigin,
          command.outbox.templateVersion,
          command.outbox.locale,
          command.outbox.subject,
          command.outbox.payloadHash,
        ],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return { status: 'accepted' };
    } catch (error) {
      try {
        await rollback();
      } catch {
        throw this.authPersistenceError();
      }
      if (this.postgresErrorCode(error) === '23505') {
        return { status: 'accepted' };
      }
      throw this.authPersistenceError();
    } finally {
      client.release();
    }
  }

  async consumeVerification(
    command: ConsumeVerificationCommand,
  ): Promise<ConsumeVerificationResult> {
    const client = await this.connectAuthClient();
    let transactionOpen = false;
    const rollback = async () => {
      if (!transactionOpen) {
        return;
      }
      await client.query('ROLLBACK');
      transactionOpen = false;
    };

    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const locked = await client.query<PendingVerificationRow>(
        `
          SELECT key_version AS "keyVersion",
                 verification_digest AS "verificationDigest",
                 attempt_count AS "attemptCount",
                 max_attempts AS "maxAttempts",
                 verification_expires_at AS "verificationExpiresAt",
                 verified_at AS "verifiedAt",
                 enrollment_digest AS "enrollmentDigest",
                 enrollment_expires_at AS "enrollmentExpiresAt",
                 completed_at AS "completedAt"
          FROM pending_registrations
          WHERE id = $1
          FOR UPDATE
        `,
        [command.pendingRegistrationId],
      );
      const row = locked.rows[0];
      if (
        !row ||
        row.keyVersion !== command.keyVersion ||
        row.attemptCount >= row.maxAttempts ||
        toTime(row.verificationExpiresAt) <= command.verifiedAt.getTime() ||
        row.verifiedAt !== null ||
        row.enrollmentDigest !== null ||
        row.enrollmentExpiresAt !== null ||
        row.completedAt !== null
      ) {
        await rollback();
        return { status: 'invalid' };
      }

      if (
        !authDigestMatches(
          row.verificationDigest,
          command.presentedVerificationDigest,
        )
      ) {
        await client.query(
          `
            UPDATE pending_registrations
            SET attempt_count = attempt_count + 1
            WHERE id = $1
              AND attempt_count < max_attempts
            RETURNING attempt_count AS "attemptCount",
                      max_attempts AS "maxAttempts"
          `,
          [command.pendingRegistrationId],
        );
        await client.query('COMMIT');
        transactionOpen = false;
        return { status: 'invalid' };
      }

      await client.query(
        `
          UPDATE pending_registrations
          SET verified_at = $2,
              enrollment_digest = $3,
              enrollment_expires_at = $4
          WHERE id = $1
        `,
        [
          command.pendingRegistrationId,
          command.verifiedAt,
          command.enrollmentDigest,
          command.enrollmentExpiresAt,
        ],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return { status: 'verified' };
    } catch {
      try {
        await rollback();
      } catch {
        throw this.authPersistenceError();
      }
      throw this.authPersistenceError();
    } finally {
      client.release();
    }
  }

  async findEnrollmentCandidate(
    command: FindEnrollmentCandidateCommand,
  ): Promise<FindEnrollmentCandidateResult> {
    try {
      const result = await this.pool.query<{ eligible: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pending_registrations
            WHERE enrollment_digest = $1
              AND verified_at IS NOT NULL
              AND enrollment_expires_at > $2
              AND completed_at IS NULL
          ) AS eligible
        `,
        [command.enrollmentDigest, command.at],
      );
      return { eligible: result.rows[0]?.eligible === true };
    } catch {
      throw this.authPersistenceError();
    }
  }

  async completeRegistration(
    command: CompleteRegistrationCommand,
  ): Promise<CompleteRegistrationResult> {
    const client = await this.connectAuthClient();
    let transactionOpen = false;
    const rollback = async () => {
      if (!transactionOpen) {
        return;
      }
      await client.query('ROLLBACK');
      transactionOpen = false;
    };

    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const locked = await client.query<CompletionPendingRow>(
        `
          SELECT id,
                 email,
                 email_canonical AS "emailCanonical",
                 verified_at AS "verifiedAt",
                 enrollment_digest AS "enrollmentDigest",
                 enrollment_expires_at AS "enrollmentExpiresAt",
                 completed_at AS "completedAt"
          FROM pending_registrations
          WHERE enrollment_digest = $1
          FOR UPDATE
        `,
        [command.enrollmentDigest],
      );
      const pending = locked.rows[0];
      if (
        !pending ||
        pending.verifiedAt === null ||
        pending.completedAt !== null ||
        pending.enrollmentExpiresAt === null ||
        toTime(pending.enrollmentExpiresAt) <= command.completedAt.getTime() ||
        !authDigestMatches(pending.enrollmentDigest, command.enrollmentDigest)
      ) {
        await rollback();
        return { status: 'invalid' };
      }

      const insertedUser = await client.query<{
        id: number;
        name: string;
        email: string;
        createdAt: Date | string;
      }>(
        `
          INSERT INTO users (
            name, email, email_canonical, password_hash,
            password_algorithm, password_parameters, password_version,
            identity_assurance, email_verified_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
          RETURNING id, name, email, created_at AS "createdAt"
        `,
        [
          command.name,
          pending.email,
          pending.emailCanonical,
          command.passwordHash,
          command.passwordAlgorithm,
          JSON.stringify(command.passwordParameters),
          command.passwordVersion,
          command.identityAssurance,
          command.completedAt,
        ],
      );
      const user = insertedUser.rows[0];
      if (!user) {
        throw this.authPersistenceError();
      }

      await client.query(
        `
          INSERT INTO sessions (
            id, token_digest, user_id, created_at,
            absolute_expires_at, idle_expires_at, last_seen_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          command.sessionId,
          command.sessionDigest,
          user.id,
          command.sessionCreatedAt,
          command.sessionAbsoluteExpiresAt,
          command.sessionIdleExpiresAt,
          command.sessionCreatedAt,
        ],
      );
      await client.query(
        `
          UPDATE pending_registrations
          SET completed_at = $2
          WHERE id = $1
            AND completed_at IS NULL
        `,
        [pending.id, command.completedAt],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        status: 'completed',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: new Date(user.createdAt).toISOString(),
        },
      };
    } catch (error) {
      try {
        await rollback();
      } catch {
        throw this.authPersistenceError();
      }
      if (this.postgresErrorCode(error) === '23505') {
        return { status: 'conflict' };
      }
      throw this.authPersistenceError();
    } finally {
      client.release();
    }
  }

  async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<User> {
    const result = await this.pool.query<UserRow>(
      `
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        `,
      [input.name, input.email, input.passwordHash],
    );

    return publicUser(result.rows[0]);
  }

  async findUserByEmail(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    const result = await this.pool.query<UserRow>(
      `
          SELECT id, name, email, password_hash AS "passwordHash",
                 preferences, created_at AS "createdAt"
          FROM users
          WHERE lower(email) = lower($1)
        `,
      [email],
    );

    return result.rows[0]
      ? {
          ...publicUser(result.rows[0]),
          passwordHash: result.rows[0].passwordHash,
        }
      : null;
  }

  async updateUser(
    id: number,
    input: {
      name?: string;
      passwordHash?: string;
      preferences?: LearningPreferences;
    },
  ): Promise<User | null> {
    const result = await this.pool.query<UserRow>(
      `
          UPDATE users
          SET name = COALESCE($2, name),
              password_hash = COALESCE($3, password_hash),
              preferences = COALESCE($4::jsonb, preferences)
          WHERE id = $1
          RETURNING id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        `,
      [
        id,
        input.name ?? null,
        input.passwordHash ?? null,
        input.preferences ? JSON.stringify(input.preferences) : null,
      ],
    );

    return result.rows[0] ? publicUser(result.rows[0]) : null;
  }

  async createSession(userId: number, token: string): Promise<Session> {
    await this.pool.query(
      `
          INSERT INTO sessions (token, user_id)
          VALUES ($1, $2)
        `,
      [token, userId],
    );

    const user = await this.findUserById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    return { token, user };
  }

  async createSessionIfPasswordHashMatches(input: {
    userId: number;
    token: string;
    expectedPasswordHash: string;
  }): Promise<Session | null> {
    const result = await this.pool.query<UserRow & { token: string }>(
      `
        WITH matching_user AS MATERIALIZED (
          SELECT id, name, email, password_hash, preferences, created_at
          FROM users
          WHERE id = $1
            AND password_hash = $2
          FOR UPDATE
        ), inserted_session AS (
          INSERT INTO sessions (token, user_id)
          SELECT $3, id
          FROM matching_user
          RETURNING token, user_id
        )
        SELECT inserted_session.token,
               matching_user.id,
               matching_user.name,
               matching_user.email,
               matching_user.password_hash AS "passwordHash",
               matching_user.preferences,
               matching_user.created_at AS "createdAt"
        FROM inserted_session
        JOIN matching_user
          ON matching_user.id = inserted_session.user_id
      `,
      [input.userId, input.expectedPasswordHash, input.token],
    );
    const row = result.rows[0];

    return row ? { token: row.token, user: publicUser(row) } : null;
  }

  async updateUserIfPasswordHashMatchesAndReplaceSessions(input: {
    userId: number;
    expectedPasswordHash: string;
    passwordHash: string;
    replacementSessionToken: string;
    name?: string;
    preferences?: LearningPreferences;
  }): Promise<Session | null> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query('BEGIN');
      transactionOpen = true;

      const updatedUser = await client.query<UserRow>(
        `
          /* password_change_user_lock */
          UPDATE users
          SET name = COALESCE($2, name),
              preferences = COALESCE($3::jsonb, preferences),
              password_hash = $4
          WHERE id = $1
            AND password_hash = $5
          RETURNING id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        `,
        [
          input.userId,
          input.name ?? null,
          input.preferences ? JSON.stringify(input.preferences) : null,
          input.passwordHash,
          input.expectedPasswordHash,
        ],
      );
      const row = updatedUser.rows[0];

      if (!row) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return null;
      }

      const currentSession = await client.query<{ token: string }>(
        `
          SELECT token
          FROM sessions
          WHERE user_id = $1
            AND token = $2
          FOR UPDATE
        `,
        [input.userId, input.replacementSessionToken],
      );

      if (!currentSession.rows[0]) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return null;
      }

      await client.query('DELETE FROM sessions WHERE user_id = $1', [
        input.userId,
      ]);
      await client.query(
        `
          INSERT INTO sessions (token, user_id)
          VALUES ($1, $2)
        `,
        [input.replacementSessionToken, input.userId],
      );
      await client.query('COMMIT');
      transactionOpen = false;

      return {
        token: input.replacementSessionToken,
        user: publicUser(row),
      };
    } catch (error) {
      if (transactionOpen) {
        await client.query('ROLLBACK');
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async findSession(token: string): Promise<Session | null> {
    const result = await this.pool.query<UserRow & { token: string }>(
      `
          SELECT s.token, u.id, u.name, u.email, u.password_hash AS "passwordHash",
                 u.preferences, u.created_at AS "createdAt"
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token = $1
        `,
      [token],
    );
    const row = result.rows[0];

    return row ? { token: row.token, user: publicUser(row) } : null;
  }

  async listPosts(input: {
    authorId?: number;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedPosts> {
    const search = input.search?.trim() || null;
    const offset = (input.page - 1) * input.pageSize;
    const authorId = input.authorId ?? null;
    const where = `
        ($1::integer IS NULL OR p.author_id = $1)
        AND ($2::text IS NULL
          OR p.title ILIKE '%' || $2 || '%'
          OR p.summary ILIKE '%' || $2 || '%'
          OR p.channel_name ILIKE '%' || $2 || '%'
          OR p.translated_notes ILIKE '%' || $2 || '%'
          OR EXISTS (
            SELECT 1 FROM post_tags pt
            JOIN tags t ON t.id = pt.tag_id
            WHERE pt.post_id = p.id AND t.name ILIKE '%' || $2 || '%'
          )
        )
      `;
    const [countResult, postsResult] = await Promise.all([
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM posts p WHERE ${where}`,
        [authorId, search],
      ),
      this.pool.query<PostRow>(
        `
            SELECT p.id, p.author_id AS "authorId", u.name AS "authorName",
                   p.title, p.video_url AS "videoUrl", p.thumbnail_url AS "thumbnailUrl",
                   p.channel_name AS "channelName", p.summary,
                   p.translated_notes AS "translatedNotes",
                   p.created_at AS "createdAt", p.updated_at AS "updatedAt"
            FROM posts p
            JOIN users u ON u.id = p.author_id
            WHERE ${where}
            ORDER BY p.updated_at DESC
            LIMIT $3 OFFSET $4
          `,
        [authorId, search, input.pageSize, offset],
      ),
    ]);
    const items = await Promise.all(
      postsResult.rows.map((row) => this.hydratePost(row)),
    );

    return {
      items,
      total: Number(countResult.rows[0]?.count ?? 0),
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async findPost(id: number): Promise<StudyPost | null> {
    const result = await this.pool.query<PostRow>(
      `
          SELECT p.id, p.author_id AS "authorId", u.name AS "authorName",
                 p.title, p.video_url AS "videoUrl", p.thumbnail_url AS "thumbnailUrl",
                 p.channel_name AS "channelName", p.summary,
                 p.translated_notes AS "translatedNotes",
                 p.created_at AS "createdAt", p.updated_at AS "updatedAt"
          FROM posts p
          JOIN users u ON u.id = p.author_id
          WHERE p.id = $1
        `,
      [id],
    );

    return result.rows[0] ? this.hydratePost(result.rows[0]) : null;
  }

  async createPost(input: CreatePostInput): Promise<StudyPost> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<PostRow>(
        `
          INSERT INTO posts (
            author_id, title, video_url, thumbnail_url, channel_name, summary, translated_notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, author_id AS "authorId",
                    (SELECT name FROM users WHERE id = $1) AS "authorName",
                    title, video_url AS "videoUrl", thumbnail_url AS "thumbnailUrl",
                    channel_name AS "channelName", summary,
                    translated_notes AS "translatedNotes",
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `,
        [
          input.authorId,
          input.title,
          input.videoUrl,
          input.thumbnailUrl ??
            'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          input.channelName ?? 'Unknown channel',
          input.summary,
          input.translatedNotes,
        ],
      );
      const post = result.rows[0];
      await this.syncTags(client, post.id, input.tags);
      await this.upsertEmbedding(
        client,
        post.id,
        [
          input.title,
          input.summary,
          input.translatedNotes,
          input.tags.join(' '),
        ].join('\n'),
      );
      await client.query('COMMIT');

      return this.hydratePost(post);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePost(
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost | null> {
    const current = await this.findPost(id);

    if (!current) {
      return null;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const next = {
        title: input.title ?? current.title,
        videoUrl: input.videoUrl ?? current.videoUrl,
        thumbnailUrl: input.thumbnailUrl ?? current.thumbnailUrl,
        channelName: input.channelName ?? current.channelName,
        summary: input.summary ?? current.summary,
        translatedNotes: input.translatedNotes ?? current.translatedNotes,
        tags: input.tags ?? current.tags,
      };
      const result = await client.query<PostRow>(
        `
          UPDATE posts
          SET title = $2,
              video_url = $3,
              thumbnail_url = $4,
              channel_name = $5,
              summary = $6,
              translated_notes = $7,
              updated_at = now()
          WHERE id = $1
          RETURNING id, author_id AS "authorId",
                    (SELECT name FROM users WHERE id = author_id) AS "authorName",
                    title, video_url AS "videoUrl", thumbnail_url AS "thumbnailUrl",
                    channel_name AS "channelName", summary,
                    translated_notes AS "translatedNotes",
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `,
        [
          id,
          next.title,
          next.videoUrl,
          next.thumbnailUrl,
          next.channelName,
          next.summary,
          next.translatedNotes,
        ],
      );
      await this.syncTags(client, id, next.tags);
      await this.upsertEmbedding(
        client,
        id,
        [
          next.title,
          next.summary,
          next.translatedNotes,
          next.tags.join(' '),
        ].join('\n'),
      );
      await client.query('COMMIT');

      return this.hydratePost(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePost(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM posts WHERE id = $1', [
      id,
    ]);

    return (result.rowCount ?? 0) > 0;
  }

  async findVideoAsset(postId: number): Promise<VideoAsset | null> {
    const result = await this.pool.query<VideoAssetRow>(
      `
          SELECT id, post_id AS "postId", video_id AS "videoId",
                 video_url AS "videoUrl", language,
                 source_language AS "sourceLanguage", status,
                 source_caption_status AS "sourceCaptionStatus",
                 translation_status AS "translationStatus",
                 summary_status AS "summaryStatus",
                 source_segments AS "sourceSegments",
                 translated_segments AS "translatedSegments",
                 summary_sections AS "summarySections",
                 transcript_body AS "transcriptBody",
                 error_message AS "errorMessage",
                 created_at AS "createdAt", updated_at AS "updatedAt"
          FROM video_assets
          WHERE post_id = $1
        `,
      [postId],
    );

    return result.rows[0] ? normalizeVideoAsset(result.rows[0]) : null;
  }

  async upsertVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset> {
    const result = await this.pool.query<VideoAssetRow>(
      `
          INSERT INTO video_assets (post_id, video_id, video_url, language)
          VALUES ($1, $2, $3, COALESCE($4::text, 'ko'))
          ON CONFLICT (post_id) DO UPDATE
          SET video_id = EXCLUDED.video_id,
              video_url = EXCLUDED.video_url,
              language = COALESCE($4::text, video_assets.language),
              error_message = '',
              updated_at = now()
          RETURNING id, post_id AS "postId", video_id AS "videoId",
                    video_url AS "videoUrl", language,
                    source_language AS "sourceLanguage", status,
                    source_caption_status AS "sourceCaptionStatus",
                    translation_status AS "translationStatus",
                    summary_status AS "summaryStatus",
                    source_segments AS "sourceSegments",
                    translated_segments AS "translatedSegments",
                    summary_sections AS "summarySections",
                    transcript_body AS "transcriptBody",
                    error_message AS "errorMessage",
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `,
      [input.postId, input.videoId, input.videoUrl, input.language ?? null],
    );

    return normalizeVideoAsset(result.rows[0]);
  }

  async updateVideoAsset(
    postId: number,
    input: UpdateVideoAssetInput,
  ): Promise<VideoAsset | null> {
    const result = await this.pool.query<VideoAssetRow>(
      `
          UPDATE video_assets
          SET language = COALESCE($2, language),
              source_language = COALESCE($3, source_language),
              status = COALESCE($4, status),
              source_caption_status = COALESCE($5, source_caption_status),
              translation_status = COALESCE($6, translation_status),
              summary_status = COALESCE($7, summary_status),
              source_segments = COALESCE($8::jsonb, source_segments),
              translated_segments = COALESCE($9::jsonb, translated_segments),
              summary_sections = COALESCE($10::jsonb, summary_sections),
              transcript_body = COALESCE($11, transcript_body),
              error_message = COALESCE($12, error_message),
              updated_at = now()
          WHERE post_id = $1
          RETURNING id, post_id AS "postId", video_id AS "videoId",
                    video_url AS "videoUrl", language,
                    source_language AS "sourceLanguage", status,
                    source_caption_status AS "sourceCaptionStatus",
                    translation_status AS "translationStatus",
                    summary_status AS "summaryStatus",
                    source_segments AS "sourceSegments",
                    translated_segments AS "translatedSegments",
                    summary_sections AS "summarySections",
                    transcript_body AS "transcriptBody",
                    error_message AS "errorMessage",
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `,
      [
        postId,
        input.language ?? null,
        input.sourceLanguage ?? null,
        input.status ?? null,
        input.sourceCaptionStatus ?? null,
        input.translationStatus ?? null,
        input.summaryStatus ?? null,
        input.sourceSegments === undefined
          ? null
          : JSON.stringify(input.sourceSegments),
        input.translatedSegments === undefined
          ? null
          : JSON.stringify(input.translatedSegments),
        input.summarySections === undefined
          ? null
          : JSON.stringify(input.summarySections),
        input.transcriptBody ?? null,
        input.errorMessage ?? null,
      ],
    );

    return result.rows[0] ? normalizeVideoAsset(result.rows[0]) : null;
  }

  async addComment(input: {
    postId: number;
    authorId: number;
    body: string;
  }): Promise<Comment> {
    const result = await this.pool.query<Comment>(
      `
          INSERT INTO comments (post_id, author_id, body)
          VALUES ($1, $2, $3)
          RETURNING id, post_id AS "postId", author_id AS "authorId",
                    (SELECT name FROM users WHERE id = $2) AS "authorName",
                    body, created_at AS "createdAt"
        `,
      [input.postId, input.authorId, input.body],
    );

    return normalizeComment(result.rows[0]);
  }

  async deleteComment(postId: number, commentId: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM comments WHERE post_id = $1 AND id = $2',
      [postId, commentId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async listPlaylists(ownerId?: number): Promise<Playlist[]> {
    const result = await this.pool.query<{
      id: number;
      ownerId: number;
      title: string;
      description: string;
      createdAt: Date | string;
    }>(
      `
          SELECT id, owner_id AS "ownerId", title, description, created_at AS "createdAt"
          FROM playlists
          WHERE ($1::int IS NULL OR owner_id = $1)
          ORDER BY created_at DESC
        `,
      [ownerId ?? null],
    );

    return Promise.all(result.rows.map((row) => this.hydratePlaylist(row)));
  }

  async createPlaylist(input: {
    ownerId: number;
    title: string;
    description: string;
    postIds: number[];
  }): Promise<Playlist> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: number;
        ownerId: number;
        title: string;
        description: string;
        createdAt: Date | string;
      }>(
        `
          INSERT INTO playlists (owner_id, title, description)
          VALUES ($1, $2, $3)
          RETURNING id, owner_id AS "ownerId", title, description, created_at AS "createdAt"
        `,
        [input.ownerId, input.title, input.description],
      );

      for (const postId of [...new Set(input.postIds)]) {
        await client.query(
          `
            INSERT INTO playlist_items (playlist_id, post_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [result.rows[0].id, postId],
        );
      }

      await client.query('COMMIT');

      return this.hydratePlaylist(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePlaylist(
    id: number,
    input: UpdatePlaylistInput,
  ): Promise<Playlist | null> {
    const current = (await this.listPlaylists()).find(
      (playlist) => playlist.id === id,
    );

    if (!current) {
      return null;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: number;
        ownerId: number;
        title: string;
        description: string;
        createdAt: Date | string;
      }>(
        `
          UPDATE playlists
          SET title = $2,
              description = $3
          WHERE id = $1
          RETURNING id, owner_id AS "ownerId", title, description, created_at AS "createdAt"
        `,
        [
          id,
          input.title ?? current.title,
          input.description ?? current.description,
        ],
      );

      if (input.postIds !== undefined) {
        await client.query(
          'DELETE FROM playlist_items WHERE playlist_id = $1',
          [id],
        );

        for (const [index, postId] of [...new Set(input.postIds)].entries()) {
          await client.query(
            `
              INSERT INTO playlist_items (playlist_id, post_id, position)
              VALUES ($1, $2, $3)
              ON CONFLICT (playlist_id, post_id) DO UPDATE
              SET position = EXCLUDED.position
            `,
            [id, postId, index + 1],
          );
        }
      }

      await client.query('COMMIT');

      return this.hydratePlaylist(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePlaylist(id: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM playlists WHERE id = $1',
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async addPlaylistItem(
    playlistId: number,
    postId: number,
  ): Promise<Playlist | null> {
    await this.pool.query(
      `
          INSERT INTO playlist_items (playlist_id, post_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
      [playlistId, postId],
    );

    const playlists = await this.listPlaylists();

    return playlists.find((playlist) => playlist.id === playlistId) ?? null;
  }

  async addPlaylistFeedback(input: {
    playlistId: number;
    authorId: number;
    rating: number;
    body: string;
  }): Promise<PlaylistFeedback> {
    const result = await this.pool.query<PlaylistFeedback>(
      `
          WITH inserted AS (
            INSERT INTO playlist_feedback (playlist_id, author_id, rating, body)
            VALUES ($1, $2, $3, $4)
            RETURNING id, playlist_id, author_id, rating, body, created_at
          )
          SELECT inserted.id,
                 inserted.playlist_id AS "playlistId",
                 inserted.author_id AS "authorId",
                 users.name AS "authorName",
                 inserted.rating,
                 inserted.body,
                 inserted.created_at AS "createdAt"
          FROM inserted
          JOIN users ON users.id = inserted.author_id
        `,
      [input.playlistId, input.authorId, input.rating, input.body],
    );

    return normalizeFeedback(result.rows[0]);
  }

  private async findUserById(id: number): Promise<User | null> {
    const result = await this.pool.query<UserRow>(
      `
        SELECT id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        FROM users
        WHERE id = $1
      `,
      [id],
    );

    return result.rows[0] ? publicUser(result.rows[0]) : null;
  }

  private async hydratePost(row: PostRow): Promise<StudyPost> {
    const [tags, comments] = await Promise.all([
      this.pool.query<{ name: string }>(
        `
          SELECT t.name
          FROM tags t
          JOIN post_tags pt ON pt.tag_id = t.id
          WHERE pt.post_id = $1
          ORDER BY t.name
        `,
        [row.id],
      ),
      this.pool.query<Comment>(
        `
          SELECT c.id, c.post_id AS "postId", c.author_id AS "authorId",
                 u.name AS "authorName", c.body, c.created_at AS "createdAt"
          FROM comments c
          JOIN users u ON u.id = c.author_id
          WHERE c.post_id = $1
          ORDER BY c.created_at ASC
        `,
        [row.id],
      ),
    ]);

    return {
      id: row.id,
      authorId: row.authorId,
      authorName: row.authorName,
      title: row.title,
      videoUrl: row.videoUrl,
      thumbnailUrl: row.thumbnailUrl,
      channelName: row.channelName,
      summary: row.summary,
      translatedNotes: row.translatedNotes,
      tags: tags.rows.map((tag) => tag.name),
      comments: comments.rows.map((comment) => normalizeComment(comment)),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private async hydratePlaylist(row: {
    id: number;
    ownerId: number;
    title: string;
    description: string;
    createdAt: Date | string;
  }): Promise<Playlist> {
    const [items, feedback] = await Promise.all([
      this.pool.query<{ postId: number }>(
        `
          SELECT post_id AS "postId"
          FROM playlist_items
          WHERE playlist_id = $1
          ORDER BY position ASC, post_id ASC
        `,
        [row.id],
      ),
      this.pool.query<PlaylistFeedback>(
        `
          SELECT pf.id,
                 pf.playlist_id AS "playlistId",
                 pf.author_id AS "authorId",
                 u.name AS "authorName",
                 pf.rating,
                 pf.body,
                 pf.created_at AS "createdAt"
          FROM playlist_feedback pf
          JOIN users u ON u.id = pf.author_id
          WHERE pf.playlist_id = $1
          ORDER BY pf.created_at DESC
        `,
        [row.id],
      ),
    ]);

    return {
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      description: row.description,
      postIds: items.rows.map((item) => item.postId),
      feedback: feedback.rows.map((item) => normalizeFeedback(item)),
      createdAt: iso(row.createdAt),
    };
  }

  private async syncTags(
    client: PoolClient,
    postId: number,
    tags: string[],
  ): Promise<void> {
    const normalized = normalizeTagNames(tags);
    await client.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);

    for (const tag of normalized) {
      const tagResult = await client.query<{ id: number }>(
        `
          INSERT INTO tags (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `,
        [tag],
      );
      await client.query(
        `
          INSERT INTO post_tags (post_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [postId, tagResult.rows[0].id],
      );
    }
  }

  private async upsertEmbedding(
    client: PoolClient,
    postId: number,
    content: string,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO post_embeddings (post_id, content, embedding)
        VALUES ($1, $2, $3::vector)
        ON CONFLICT (post_id)
        DO UPDATE SET content = EXCLUDED.content,
                      embedding = EXCLUDED.embedding,
                      updated_at = now()
      `,
      [postId, content, vectorLiteral(content)],
    );
  }

  private positiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private nonNegativeInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private wait(milliseconds: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  private toErrorMessage(error: unknown): string {
    const message = this.sanitizeDatabaseErrorMessage(
      error instanceof Error ? error.message : 'Unknown error',
    );
    const code = this.postgresErrorCode(error);

    return code ? `${message} (PostgreSQL code ${code})` : message;
  }

  private sanitizeDatabaseErrorMessage(message: string): string {
    return message
      .replace(/\b(postgres(?:ql)?:\/\/)[^\s/@?#]+@/giu, '$1[redacted]@')
      .replace(
        /([?&][^=&#\s]*(?:password|token|secret)[^=&#\s]*=)[^&#\s]*/giu,
        '$1[redacted]',
      );
  }

  private postgresErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return undefined;
    }

    const code = (error as { code?: unknown }).code;

    return typeof code === 'string' && /^[0-9A-Z]{5}$/iu.test(code)
      ? code
      : undefined;
  }

  private authPersistenceError(): Error {
    return new Error('Authentication persistence failed');
  }

  private async connectAuthClient(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch {
      throw this.authPersistenceError();
    }
  }
}

type PendingVerificationRow = {
  keyVersion: number;
  verificationDigest: Buffer;
  attemptCount: number;
  maxAttempts: number;
  verificationExpiresAt: Date | string;
  verifiedAt: Date | string | null;
  enrollmentDigest: Buffer | null;
  enrollmentExpiresAt: Date | string | null;
  completedAt: Date | string | null;
};

type CompletionPendingRow = {
  id: string;
  email: string;
  emailCanonical: string;
  verifiedAt: Date | string | null;
  enrollmentDigest: Buffer;
  enrollmentExpiresAt: Date | string | null;
  completedAt: Date | string | null;
};

function authDigestMatches(stored: Buffer, presented: Buffer): boolean {
  return (
    Buffer.isBuffer(stored) &&
    Buffer.isBuffer(presented) &&
    stored.length === 32 &&
    presented.length === 32 &&
    timingSafeEqual(stored, presented)
  );
}

function toTime(value: Date | string): number {
  return new Date(value).getTime();
}
