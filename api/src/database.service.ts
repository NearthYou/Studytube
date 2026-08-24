import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool, PoolClient, type QueryConfig } from 'pg';
import { AuthRepositoryUnavailableError } from './auth/auth.repository';
import {
  PostgresVerificationEmailOutboxRepository,
  type VerificationEmailOutboxRepository,
} from './auth/verification-email-outbox.repository';
import type {
  CompleteRegistrationCommand,
  CompleteRegistrationResult,
  CommitLoginCommand,
  CommitLoginResult,
  ConsumeVerificationCommand,
  ConsumeVerificationResult,
  FindActiveSessionCommand,
  FindActiveSessionResult,
  FindAuthUserCommand,
  FindAuthUserResult,
  FindEnrollmentCandidateCommand,
  FindEnrollmentCandidateResult,
  FindEnrollmentReadinessCommand,
  FindEnrollmentReadinessResult,
  PendingRegistrationCommand,
  PendingRegistrationResult,
  RateLimitCommand,
  RateLimitResult,
  RevokeActiveSessionCommand,
  RevokeActiveSessionResult,
  UpdateProfileCommand,
  UpdateProfileResult,
} from './auth/auth.types';
import {
  iso,
  normalizeComment,
  normalizeFeedback,
  normalizePreferences,
  normalizeTagNames,
  normalizeVideoAsset,
  type PostRow,
  type VideoAssetRow,
} from './database-board.mapper';
import {
  BoardRepository,
  Comment,
  CreatePostInput,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  StudyPost,
  UpdatePlaylistInput,
  UpdatePostInput,
} from './study-board.types';
import type {
  CreateVideoAssetInput,
  UpdateVideoAssetInput,
  VideoAsset,
} from './video-asset.types';
import { COURSE_CUTOVER_ADVISORY_LOCK_KEY } from './course/course-cutover.policy';
import type { CourseRepository } from './course/course.repository';
import { PostgresCourseRepository } from './course/postgres-course.repository';
import type { LearningItemRepository } from './learning/learning-item.repository';
import { PostgresLearningItemRepository } from './learning/postgres-learning-item.repository';
import type { CaptionArtifactRepository } from './video-asset.types';
import { PostgresCaptionArtifactRepository } from './postgres-caption-artifact.repository';
import { PostgresLiveCaptionRepository } from './postgres-live-caption.repository';
import type { LiveCaptionRepository } from './live-caption.service';
import { PostgresWorkRepository } from './work/postgres-work.repository';
import type { WorkRepository } from './work/work.repository';
import { PostgresRetrievalRepository } from './retrieval/postgres-retrieval.repository';
import type { RetrievalRepository } from './retrieval/retrieval.repository';
import {
  assertLearningCutoverAuthority,
  assertRequiredMigrationsApplied,
  requiredMigrationNames,
  resolveDatabaseUrl,
} from './database-migration-readiness';
import { resolveCourseCutoverMode } from './course/course-cutover.policy';
import {
  observabilityRuntime,
  type ObservabilityRuntime,
} from './observability/runtime';
import { observePostgresPool } from './observability/postgres-pool-observer';

@Injectable()
export class DatabaseService
  implements BoardRepository, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly databaseInitAttempts: number;
  private readonly databaseInitRetryDelayMs: number;
  private readonly databaseQueryTimeoutMs: number;
  private readonly verificationEmailMaxAttempts: number;
  private readonly stopPoolObservation: () => void;
  private courseRepository?: CourseRepository;
  private learningItemRepository?: LearningItemRepository;
  private captionArtifactRepository?: CaptionArtifactRepository;
  private liveCaptionRepository?: LiveCaptionRepository;
  private workRepository?: WorkRepository;
  private retrievalRepository?: RetrievalRepository;
  private verificationEmailOutboxRepository?: VerificationEmailOutboxRepository;
  private courseWriterLeaseStateTail: Promise<void> = Promise.resolve();
  private courseWriterLeaseClient?: PoolClient;
  private activeCourseWriterLeases = 0;
  private pendingCourseWriterLeases = 0;

  constructor(
    configService: ConfigService,
    @Optional()
    observability: ObservabilityRuntime = observabilityRuntime,
  ) {
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
    this.verificationEmailMaxAttempts = this.positiveInteger(
      configService.get<string>('AUTH_EMAIL_MAX_ATTEMPTS'),
      5,
    );
    this.pool = new Pool({
      connectionString: resolveDatabaseUrl(
        process.env,
        configService.get<string>('DATABASE_URL'),
      ),
      connectionTimeoutMillis: 3000,
    });
    this.stopPoolObservation = observePostgresPool(
      this.pool,
      observability.metrics,
    );
  }

  async onModuleInit() {
    await this.initializeDatabaseWithRetry();
  }

  private async initializeDatabaseWithRetry() {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.databaseInitAttempts; attempt += 1) {
      try {
        await this.probeDatabase();
        if (process.env.NODE_ENV === 'production') {
          await assertRequiredMigrationsApplied(
            this.pool,
            requiredMigrationNames(process.env),
          );
          await assertLearningCutoverAuthority(this.pool, {
            mode: resolveCourseCutoverMode(
              process.env.COURSE_CUTOVER_MODE,
              process.env.NODE_ENV,
            ),
            writerRelease: process.env.DEPLOY_SHA?.trim() ?? '',
          });
        }
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
    try {
      await this.pool.end();
    } finally {
      this.stopPoolObservation();
    }
  }

  getCourseRepository(): CourseRepository {
    this.courseRepository ??= new PostgresCourseRepository(this.pool);
    return this.courseRepository;
  }

  getLearningItemRepository(): LearningItemRepository {
    this.learningItemRepository ??= new PostgresLearningItemRepository(
      this.pool,
    );
    return this.learningItemRepository;
  }

  getCaptionArtifactRepository(): CaptionArtifactRepository {
    this.captionArtifactRepository ??= new PostgresCaptionArtifactRepository(
      this.pool,
    );
    return this.captionArtifactRepository;
  }

  getLiveCaptionRepository(): LiveCaptionRepository {
    this.liveCaptionRepository ??= new PostgresLiveCaptionRepository(this.pool);
    return this.liveCaptionRepository;
  }

  getWorkRepository(): WorkRepository {
    this.workRepository ??= new PostgresWorkRepository(this.pool);
    return this.workRepository;
  }

  getRetrievalRepository(): RetrievalRepository {
    this.retrievalRepository ??= new PostgresRetrievalRepository(this.pool);
    return this.retrievalRepository;
  }

  getVerificationEmailOutboxRepository(): VerificationEmailOutboxRepository {
    this.verificationEmailOutboxRepository ??=
      new PostgresVerificationEmailOutboxRepository(this.pool);
    return this.verificationEmailOutboxRepository;
  }

  async withCourseWriterSharedLease<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    this.pendingCourseWriterLeases += 1;
    await this.withCourseWriterLeaseState(async () => {
      this.pendingCourseWriterLeases -= 1;
      if (!this.courseWriterLeaseClient) {
        const client = await this.pool.connect();
        try {
          await client.query('SELECT pg_advisory_lock_shared($1)', [
            COURSE_CUTOVER_ADVISORY_LOCK_KEY,
          ]);
          this.courseWriterLeaseClient = client;
        } catch (error) {
          client.release(true);
          throw error;
        }
      }
      this.activeCourseWriterLeases += 1;
    });

    try {
      return await operation();
    } finally {
      await this.withCourseWriterLeaseState(async () => {
        this.activeCourseWriterLeases -= 1;
        if (
          this.activeCourseWriterLeases !== 0 ||
          this.pendingCourseWriterLeases !== 0 ||
          !this.courseWriterLeaseClient
        ) {
          return;
        }

        const client = this.courseWriterLeaseClient;
        this.courseWriterLeaseClient = undefined;
        let destroyClient = false;
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            'SELECT pg_advisory_unlock_shared($1) AS unlocked',
            [COURSE_CUTOVER_ADVISORY_LOCK_KEY],
          );
          destroyClient = unlocked.rows[0]?.unlocked !== true;
        } catch {
          destroyClient = true;
        } finally {
          client.release(destroyClient);
        }
      });
    }
  }

  private async withCourseWriterLeaseState<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.courseWriterLeaseStateTail;
    let releaseState: () => void = () => undefined;
    this.courseWriterLeaseStateTail = new Promise<void>((resolve) => {
      releaseState = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      releaseState();
    }
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

  async findAuthUser(
    command: FindAuthUserCommand,
  ): Promise<FindAuthUserResult> {
    try {
      const result = await this.pool.query<AuthUserCredentialRow>(
        `
          SELECT id, name, email,
                 preferences,
                 email_canonical AS "emailCanonical",
                 password_hash AS "passwordHash",
                 password_algorithm AS "passwordAlgorithm",
                 password_parameters AS "passwordParameters",
                 password_version AS "passwordVersion",
                 identity_assurance AS "identityAssurance",
                 created_at AS "createdAt"
          FROM users
          WHERE email_canonical = $1
        `,
        [command.emailCanonical],
      );
      const row = result.rows[0];
      return {
        user: row
          ? {
              ...row,
              preferences: normalizePreferences(row.preferences),
              createdAt: new Date(row.createdAt).toISOString(),
            }
          : null,
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
      await client.query(
        `
          SELECT pg_advisory_xact_lock(
            hashtextextended('auth-registration:' || $1, 0)
          )
        `,
        [command.emailCanonical],
      );
      const active = await client.query<PendingRegistrationEligibilityRow>(
        `
          SELECT pending.id,
                 pending.verified_at AS "verifiedAt",
                 EXISTS (
                   SELECT 1
                   FROM verification_email_outbox AS outbox
                   WHERE outbox.pending_registration_id = pending.id
                     AND outbox.sent_at IS NULL
                     AND outbox.failed_at IS NULL
                     AND (
                       outbox.attempts < $2
                       OR (
                         outbox.lease_token IS NOT NULL
                         AND outbox.lease_expires_at > statement_timestamp()
                       )
                     )
                 ) AS "deliveryInProgress"
          FROM pending_registrations AS pending
          WHERE pending.email_canonical = $1
            AND pending.completed_at IS NULL
            AND (
              (
                pending.verified_at IS NULL
                AND pending.verification_expires_at
                  > statement_timestamp() + interval '2 minutes'
                AND pending.attempt_count < pending.max_attempts
              )
              OR (
                pending.verified_at IS NOT NULL
                AND pending.enrollment_expires_at > statement_timestamp()
              )
            )
          ORDER BY (pending.verified_at IS NOT NULL) DESC,
                   pending.created_at DESC,
                   pending.id DESC
          LIMIT 1
          FOR UPDATE OF pending
        `,
        [command.emailCanonical, this.verificationEmailMaxAttempts],
      );
      const account = await client.query<{ userExists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM users
            WHERE email_canonical = $1
          ) AS "userExists"
        `,
        [command.emailCanonical],
      );
      const userExists = account.rows[0]?.userExists;
      if (userExists === undefined) {
        throw new Error('Registration eligibility query returned no state');
      }
      if (
        userExists ||
        active.rows.some((row) => row.verifiedAt !== null) ||
        (command.action === 'signup' && active.rows.length > 0)
      ) {
        await client.query('COMMIT');
        transactionOpen = false;
        return { status: 'accepted' };
      }

      const activePending = active.rows[0];
      if (command.action === 'resend' && activePending) {
        if (activePending.deliveryInProgress) {
          await client.query('COMMIT');
          transactionOpen = false;
          return { status: 'accepted' };
        }
        await client.query(
          `
            UPDATE verification_email_outbox
            SET failed_at = statement_timestamp(),
                last_error_code = 'delivery_attempts_exhausted',
                lease_token = NULL,
                lease_expires_at = NULL
            WHERE pending_registration_id = $1
              AND sent_at IS NULL
              AND failed_at IS NULL
              AND attempts >= $2
              AND (
                lease_token IS NULL
                OR lease_expires_at <= statement_timestamp()
              )
          `,
          [activePending.id, this.verificationEmailMaxAttempts],
        );
        const requeued = await client.query(
          `
            INSERT INTO verification_email_outbox (
              id, pending_registration_id, recipient, idempotency_key,
              sender, public_origin, template_version, locale, subject,
              payload_hash
            )
            SELECT $1, source.pending_registration_id, source.recipient, $2,
                   source.sender, source.public_origin,
                   source.template_version, source.locale, source.subject,
                   source.payload_hash
            FROM verification_email_outbox AS source
            WHERE source.pending_registration_id = $3
            ORDER BY source.created_at DESC, source.id DESC
            LIMIT 1
          `,
          [command.outbox.id, command.outbox.idempotencyKey, activePending.id],
        );
        if (requeued.rowCount !== 1) {
          throw new Error('Pending registration has no delivery intent');
        }
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

      type InsertedUser = {
        id: number;
        name: string;
        email: string;
        preferences: unknown;
        createdAt: Date | string;
      };
      let user: InsertedUser | undefined;
      try {
        const insertedUser = await client.query<InsertedUser>(
          `
            INSERT INTO users (
              name, email, email_canonical, password_hash,
              password_algorithm, password_parameters, password_version,
              identity_assurance, email_verified_at
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
            RETURNING id, name, email, preferences, created_at AS "createdAt"
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
        user = insertedUser.rows[0];
      } catch (error) {
        if (this.isUserEmailUniqueViolation(error)) {
          await rollback();
          return { status: 'conflict' };
        }
        throw error;
      }
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
          preferences: normalizePreferences(user.preferences),
          createdAt: new Date(user.createdAt).toISOString(),
        },
      };
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

  async commitLogin(command: CommitLoginCommand): Promise<CommitLoginResult> {
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
      const locked = await client.query<AuthUserCredentialRow>(
        `
          SELECT id, name, email,
                 preferences,
                 email_canonical AS "emailCanonical",
                 password_hash AS "passwordHash",
                 password_algorithm AS "passwordAlgorithm",
                 password_parameters AS "passwordParameters",
                 password_version AS "passwordVersion",
                 identity_assurance AS "identityAssurance",
                 created_at AS "createdAt"
          FROM users
          WHERE id = $1
            AND password_hash = $2
            AND password_version = $3
          FOR UPDATE
        `,
        [
          command.userId,
          command.expectedPasswordHash,
          command.expectedPasswordVersion,
        ],
      );
      const user = locked.rows[0];
      if (!user) {
        await rollback();
        return { status: 'stale' };
      }
      if (
        user.passwordAlgorithm === 'disabled' ||
        (user.identityAssurance !== 'email_verified' &&
          user.identityAssurance !== 'legacy_grandfathered')
      ) {
        await rollback();
        return { status: 'invalid' };
      }

      if (command.passwordUpgrade) {
        const upgraded = await client.query(
          `
            UPDATE users
            SET password_hash = $2,
                password_algorithm = $3,
                password_parameters = $4::jsonb,
                password_version = $5
            WHERE id = $1
              AND password_hash = $6
              AND password_version = $7
          `,
          [
            command.userId,
            command.passwordUpgrade.passwordHash,
            command.passwordUpgrade.passwordAlgorithm,
            JSON.stringify(command.passwordUpgrade.passwordParameters),
            command.passwordUpgrade.passwordVersion,
            command.expectedPasswordHash,
            command.expectedPasswordVersion,
          ],
        );
        if (upgraded.rowCount !== 1) {
          await rollback();
          return { status: 'stale' };
        }
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
          command.userId,
          command.sessionCreatedAt,
          command.sessionAbsoluteExpiresAt,
          command.sessionIdleExpiresAt,
        ],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        status: 'committed',
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
        throw this.authPersistenceError();
      }
      throw this.authPersistenceError();
    } finally {
      client.release();
    }
  }

  async updateProfile(
    command: UpdateProfileCommand,
  ): Promise<UpdateProfileResult> {
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
      const locked = await client.query<AuthUserCredentialRow>(
        `
          SELECT id, name, email,
                 preferences,
                 email_canonical AS "emailCanonical",
                 password_hash AS "passwordHash",
                 password_algorithm AS "passwordAlgorithm",
                 password_parameters AS "passwordParameters",
                 password_version AS "passwordVersion",
                 identity_assurance AS "identityAssurance",
                 created_at AS "createdAt"
          FROM users
          WHERE id = $1
          FOR UPDATE
        `,
        [command.userId],
      );
      const current = locked.rows[0];
      if (!current) {
        await rollback();
        return { status: 'missing' };
      }

      const checksCredential =
        command.expectedPasswordHash !== undefined ||
        command.expectedPasswordVersion !== undefined;
      if (
        checksCredential &&
        (command.expectedPasswordHash === undefined ||
          command.expectedPasswordVersion === undefined ||
          current.passwordHash !== command.expectedPasswordHash ||
          current.passwordVersion !== command.expectedPasswordVersion)
      ) {
        await rollback();
        return { status: 'stale' };
      }

      const updated = await client.query<ProfileUserRow>(
        `
          UPDATE users
          SET name = COALESCE($2::text, name),
              preferences = COALESCE($3::jsonb, preferences),
              password_hash = COALESCE($4::text, password_hash),
              password_algorithm = COALESCE($5::text, password_algorithm),
              password_parameters = COALESCE($6::jsonb, password_parameters),
              password_version = COALESCE($7::integer, password_version)
          WHERE id = $1
          RETURNING id, name, email, preferences, created_at AS "createdAt"
        `,
        [
          command.userId,
          command.name ?? null,
          command.preferences ? JSON.stringify(command.preferences) : null,
          command.passwordUpgrade?.passwordHash ?? null,
          command.passwordUpgrade?.passwordAlgorithm ?? null,
          command.passwordUpgrade
            ? JSON.stringify(command.passwordUpgrade.passwordParameters)
            : null,
          command.passwordUpgrade?.passwordVersion ?? null,
        ],
      );
      const user = updated.rows[0];
      if (!user) {
        throw this.authPersistenceError();
      }

      if (command.passwordUpgrade) {
        await client.query(
          `
            UPDATE sessions
            SET revoked_at = statement_timestamp(),
                revoke_reason = 'password_change'
            WHERE user_id = $1
              AND id <> $2
              AND revoked_at IS NULL
          `,
          [command.userId, command.sessionId],
        );
      }

      await client.query('COMMIT');
      transactionOpen = false;
      return {
        status: 'updated',
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
        throw this.authPersistenceError();
      }
      throw this.authPersistenceError();
    } finally {
      client.release();
    }
  }

  async findActiveSession(
    command: FindActiveSessionCommand,
  ): Promise<FindActiveSessionResult> {
    try {
      const result = await this.pool.query<ActiveSessionRow>(
        `
          WITH active_session AS MATERIALIZED (
            SELECT s.id AS "sessionId",
                   s.user_id AS "userId",
                   s.last_seen_at AS "lastSeenAt",
                   u.name,
                   u.email,
                   u.preferences,
                   u.created_at AS "userCreatedAt"
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_digest = $1
              AND s.revoked_at IS NULL
              AND s.absolute_expires_at > statement_timestamp()
              AND s.idle_expires_at > statement_timestamp()
            FOR UPDATE OF s
          ), touched AS (
            UPDATE sessions s
            SET last_seen_at = statement_timestamp(),
                idle_expires_at = LEAST(
                  s.absolute_expires_at,
                  statement_timestamp() + interval '24 hours'
                )
            FROM active_session active
            WHERE s.id = active."sessionId"
              AND active."lastSeenAt" <=
                  statement_timestamp() - interval '15 minutes'
            RETURNING s.id
          )
          SELECT "sessionId", "userId", name, email, preferences, "userCreatedAt"
          FROM active_session
        `,
        [command.sessionDigest],
      );
      const row = result.rows[0];
      if (!row) {
        return { status: 'invalid' };
      }
      return Object.freeze({
        status: 'active',
        principal: Object.freeze({
          sessionId: row.sessionId,
          userId: row.userId,
        }),
        user: Object.freeze({
          id: row.userId,
          name: row.name,
          email: row.email,
          preferences: normalizePreferences(row.preferences),
          createdAt: new Date(row.userCreatedAt).toISOString(),
        }),
      });
    } catch {
      throw this.authPersistenceError();
    }
  }

  async revokeActiveSession(
    command: RevokeActiveSessionCommand,
  ): Promise<RevokeActiveSessionResult> {
    try {
      const result = await this.pool.query<{ id: string }>(
        `
          UPDATE sessions
          SET revoked_at = statement_timestamp(),
              revoke_reason = $2
          WHERE token_digest = $1
            AND revoked_at IS NULL
            AND absolute_expires_at > statement_timestamp()
            AND idle_expires_at > statement_timestamp()
          RETURNING id
        `,
        [command.sessionDigest, command.reason],
      );
      return result.rows[0] ? { status: 'revoked' } : { status: 'invalid' };
    } catch {
      throw this.authPersistenceError();
    }
  }

  async findEnrollmentReadiness(
    command: FindEnrollmentReadinessCommand,
  ): Promise<FindEnrollmentReadinessResult> {
    try {
      const result = await this.pool.query<{ ready: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pending_registrations
            WHERE enrollment_digest = $1
              AND verified_at IS NOT NULL
              AND enrollment_expires_at > statement_timestamp()
              AND completed_at IS NULL
          ) AS ready
        `,
        [command.enrollmentDigest],
      );
      return result.rows[0]?.ready === true
        ? { status: 'ready' }
        : { status: 'invalid' };
    } catch {
      throw this.authPersistenceError();
    }
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
      await this.getWorkRepository().appendOutboxEvent(
        this.videoAssetRequestedEvent({
          id: post.id,
          authorId: post.authorId,
          title: post.title,
          videoUrl: post.videoUrl,
        }),
        client,
      );
      await this.getWorkRepository().appendOutboxEvent(
        this.retrievalEmbeddingRequestedEvent(post.id),
        client,
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
      if (next.videoUrl !== current.videoUrl) {
        await this.getWorkRepository().appendOutboxEvent(
          this.videoAssetRequestedEvent({
            id,
            authorId: current.authorId,
            title: next.title,
            videoUrl: next.videoUrl,
          }),
          client,
        );
      }
      await this.getWorkRepository().appendOutboxEvent(
        this.retrievalEmbeddingRequestedEvent(id),
        client,
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

  async hasCompletedCourseBackfillAuditForPost(
    postId: number,
  ): Promise<boolean> {
    const result = await this.pool.query<{ audited: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM playlist_items AS item
          JOIN course_backfill_audits AS audit
            ON audit.legacy_playlist_id = item.playlist_id
          WHERE item.post_id = $1
        ) AS audited
      `,
      [postId],
    );

    return result.rows[0]?.audited ?? false;
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

  async requestVideoAssetPreparation(
    input: CreateVideoAssetInput,
  ): Promise<VideoAsset> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<VideoAssetRow>(
        `
          INSERT INTO video_assets (
            post_id,
            video_id,
            video_url,
            language,
            status,
            source_caption_status,
            translation_status,
            summary_status
          )
          VALUES (
            $1, $2, $3, COALESCE($4::text, 'ko'),
            'processing', 'pending', 'pending', 'pending'
          )
          ON CONFLICT (post_id) DO UPDATE
          SET video_id = EXCLUDED.video_id,
              video_url = EXCLUDED.video_url,
              language = EXCLUDED.language,
              source_language = '',
              status = 'processing',
              source_caption_status = 'pending',
              translation_status = 'pending',
              summary_status = 'pending',
              source_segments = '[]'::jsonb,
              translated_segments = '[]'::jsonb,
              summary_sections = '[]'::jsonb,
              transcript_body = '',
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
      await this.getWorkRepository().appendOutboxEvent(
        {
          id: randomUUID(),
          eventType: 'video_asset.requested',
          aggregateType: 'post',
          aggregateId: String(input.postId),
          aggregateVersion: 1,
          payloadSchemaVersion: 1,
          payload: {
            postId: input.postId,
            videoUrl: input.videoUrl,
          },
        },
        client,
      );
      await client.query('COMMIT');
      return normalizeVideoAsset(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  private videoAssetRequestedEvent(post: {
    id: number;
    authorId: number;
    title: string;
    videoUrl: string;
  }) {
    return {
      id: randomUUID(),
      eventType: 'video_asset.requested',
      aggregateType: 'post',
      aggregateId: String(post.id),
      aggregateVersion: 1,
      payloadSchemaVersion: 1,
      payload: {
        postId: post.id,
        authorId: post.authorId,
        title: post.title,
        videoUrl: post.videoUrl,
      },
    };
  }

  private retrievalEmbeddingRequestedEvent(postId: number) {
    return {
      id: randomUUID(),
      eventType: 'retrieval_embedding.requested',
      aggregateType: 'post',
      aggregateId: String(postId),
      aggregateVersion: 1,
      payloadSchemaVersion: 1,
      payload: { postId },
    };
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

  private authPersistenceError(): AuthRepositoryUnavailableError {
    return new AuthRepositoryUnavailableError();
  }

  private isUserEmailUniqueViolation(error: unknown): boolean {
    if (this.postgresErrorCode(error) !== '23505') {
      return false;
    }
    const constraint = this.postgresErrorConstraint(error);
    return (
      constraint === 'users_email_canonical_key' ||
      constraint === 'users_email_key'
    );
  }

  private postgresErrorConstraint(error: unknown): string | undefined {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('constraint' in error)
    ) {
      return undefined;
    }
    const constraint = (error as { constraint?: unknown }).constraint;
    return typeof constraint === 'string' ? constraint : undefined;
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

type PendingRegistrationEligibilityRow = {
  id: string;
  verifiedAt: Date | string | null;
  deliveryInProgress: boolean;
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

type AuthUserCredentialRow = {
  id: number;
  name: string;
  email: string;
  preferences: unknown;
  emailCanonical: string;
  passwordHash: string;
  passwordAlgorithm: 'argon2id' | 'legacy_sha256' | 'disabled';
  passwordParameters: Record<string, unknown>;
  passwordVersion: number;
  identityAssurance: 'email_verified' | 'legacy_grandfathered';
  createdAt: Date | string;
};

type ActiveSessionRow = {
  sessionId: string;
  userId: number;
  name: string;
  email: string;
  preferences: unknown;
  userCreatedAt: Date | string;
};

type ProfileUserRow = {
  id: number;
  name: string;
  email: string;
  preferences: unknown;
  createdAt: Date | string;
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
