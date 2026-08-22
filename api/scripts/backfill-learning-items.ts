import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { COURSE_CUTOVER_ADVISORY_LOCK_KEY } from '../src/course/course-cutover.policy';
import { canonicalizeYoutubeUrl } from '../src/learning/youtube-url.policy';
import {
  verifyLearningItemBackfillSnapshot,
  type LearningItemBackfillVerification,
} from './verify-learning-item-backfill';

export const LEARNING_CUTOVER_MIGRATION_VERSION =
  '1753660819000_learning-cutover-authority';

type MappingKind =
  | 'post'
  | 'course_step'
  | 'learning_progress'
  | 'learning_progress_event'
  | 'quiz_attempt';

interface MappingSourceRow {
  entityKind: MappingKind;
  legacyEntityId: string;
  userId: number;
  videoUrl: string;
  courseStepId: string | null;
  sourcePostId: number | null;
}

interface BackfillOptions {
  batchSize: number;
  writerRelease: string;
  runId?: string;
}

export interface BackfillResult {
  runId: string;
  writerRelease: string;
  sourceWatermark: number;
  processedWatermark: number;
  mappedRows: number;
}

interface ActivationOptions {
  runId: string;
  writerRelease: string;
  maxFreezeMs: number;
  skipDeltaCatchUpForTest?: boolean;
}

export type ActivationResult =
  | {
      activated: true;
      verification: LearningItemBackfillVerification;
      freezeWatermark: number;
    }
  | {
      activated: false;
      reason: 'FREEZE_TIMEOUT' | 'PARITY_FAILED' | 'LOCK_UNAVAILABLE';
      verification?: LearningItemBackfillVerification;
    };

const SOURCE_QUERIES = [
  `SELECT 'post'::text AS "entityKind", post.id::text AS "legacyEntityId",
          post.author_id AS "userId", post.video_url AS "videoUrl",
          NULL::text AS "courseStepId", post.id AS "sourcePostId"
   FROM posts AS post ORDER BY post.id LIMIT $1 OFFSET $2`,
  `SELECT 'course_step'::text AS "entityKind", step.id::text AS "legacyEntityId",
          course.owner_id AS "userId", step.video_url_snapshot AS "videoUrl",
          step.id::text AS "courseStepId", step.source_post_id AS "sourcePostId"
   FROM course_steps AS step
   JOIN courses AS course ON course.id = step.course_id
   ORDER BY step.id LIMIT $1 OFFSET $2`,
  `SELECT 'learning_progress'::text AS "entityKind", progress.id::text AS "legacyEntityId",
          progress.user_id AS "userId", step.video_url_snapshot AS "videoUrl",
          step.id::text AS "courseStepId", NULL::integer AS "sourcePostId"
   FROM learning_progress AS progress
   JOIN course_steps AS step ON step.id = progress.course_step_id
   ORDER BY progress.id LIMIT $1 OFFSET $2`,
  `SELECT 'learning_progress_event'::text AS "entityKind", event.id::text AS "legacyEntityId",
          event.user_id AS "userId", step.video_url_snapshot AS "videoUrl",
          step.id::text AS "courseStepId", NULL::integer AS "sourcePostId"
   FROM learning_progress_events AS event
   JOIN course_steps AS step ON step.id = event.course_step_id
   ORDER BY event.id LIMIT $1 OFFSET $2`,
  `SELECT 'quiz_attempt'::text AS "entityKind", attempt.id::text AS "legacyEntityId",
          attempt.user_id AS "userId", step.video_url_snapshot AS "videoUrl",
          step.id::text AS "courseStepId", NULL::integer AS "sourcePostId"
   FROM quiz_attempts AS attempt
   JOIN quizzes AS quiz ON quiz.id = attempt.quiz_id
   JOIN course_steps AS step ON step.id = quiz.course_step_id
   ORDER BY attempt.id LIMIT $1 OFFSET $2`,
] as const;

export async function backfillLearningItems(
  pool: Pick<Pool, 'connect'>,
  options: BackfillOptions,
): Promise<BackfillResult> {
  assertBackfillOptions(options);
  const client = await pool.connect();
  try {
    const run = await startOrResumeRun(client, options);
    const mappedRows = await applyAllMappings(client, options.batchSize);
    const processedWatermark = await currentWatermark(client);
    await client.query(
      `UPDATE learning_cutover_runs
       SET state = 'ready', processed_watermark = $2,
           cursors = '{}'::jsonb, updated_at = statement_timestamp()
       WHERE id = $1`,
      [run.runId, processedWatermark],
    );
    return { ...run, processedWatermark, mappedRows };
  } catch (error) {
    if (options.runId) {
      await markRunAborted(client, options.runId, 'BACKFILL_FAILED');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function activateLearningCutover(
  pool: Pick<Pool, 'connect'>,
  options: ActivationOptions,
): Promise<ActivationResult> {
  assertActivationOptions(options);
  const client = await pool.connect();
  let lockHeld = false;
  try {
    const run = await requireRun(client, options.runId, options.writerRelease);
    if (options.maxFreezeMs === 0) {
      await markRunAborted(client, options.runId, 'FREEZE_TIMEOUT');
      return { activated: false, reason: 'FREEZE_TIMEOUT' };
    }
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [COURSE_CUTOVER_ADVISORY_LOCK_KEY],
    );
    if (lock.rows[0]?.acquired !== true) {
      await markRunAborted(client, options.runId, 'LOCK_UNAVAILABLE');
      return { activated: false, reason: 'LOCK_UNAVAILABLE' };
    }
    lockHeld = true;
    const freezeStartedAt = Date.now();
    await client.query(
      `UPDATE learning_cutover_runs
       SET state = 'frozen', updated_at = statement_timestamp()
       WHERE id = $1`,
      [options.runId],
    );

    if (!options.skipDeltaCatchUpForTest) {
      await applyAllMappings(client, 500);
    }
    const freezeWatermark = await currentWatermark(client);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let verification: LearningItemBackfillVerification;
    try {
      verification = await verifyLearningItemBackfillSnapshot(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    if (Date.now() - freezeStartedAt > options.maxFreezeMs) {
      await recordVerification(
        client,
        options.runId,
        run.sourceWatermark,
        freezeWatermark,
        verification,
        'FREEZE_TIMEOUT',
      );
      return { activated: false, reason: 'FREEZE_TIMEOUT', verification };
    }
    if (!verification.ok) {
      await recordVerification(
        client,
        options.runId,
        run.sourceWatermark,
        freezeWatermark,
        verification,
        'PARITY_FAILED',
      );
      return { activated: false, reason: 'PARITY_FAILED', verification };
    }

    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO learning_cutover_authority (
           singleton, run_id, source_watermark, freeze_watermark,
           source_count, target_count, source_fingerprint, target_fingerprint,
           migration_version, writer_release
         ) VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          options.runId,
          run.sourceWatermark,
          freezeWatermark,
          verification.sourceCount,
          verification.targetCount,
          verification.sourceFingerprint,
          verification.targetFingerprint,
          LEARNING_CUTOVER_MIGRATION_VERSION,
          options.writerRelease,
        ],
      );
      await client.query(
        `UPDATE learning_cutover_runs
         SET state = 'activated', processed_watermark = $2,
             source_count = $3, target_count = $4,
             source_fingerprint = $5, target_fingerprint = $6,
             diagnostics = $7::jsonb, activated_at = statement_timestamp(),
             updated_at = statement_timestamp()
         WHERE id = $1`,
        [
          options.runId,
          freezeWatermark,
          verification.sourceCount,
          verification.targetCount,
          verification.sourceFingerprint,
          verification.targetFingerprint,
          JSON.stringify(verification),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return { activated: true, verification, freezeWatermark };
  } catch (error) {
    await markRunAborted(client, options.runId, 'ACTIVATION_FAILED');
    throw error;
  } finally {
    if (lockHeld) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [
        COURSE_CUTOVER_ADVISORY_LOCK_KEY,
      ]);
    }
    client.release();
  }
}

async function applyAllMappings(
  client: PoolClient,
  batchSize: number,
): Promise<number> {
  let mappedRows = 0;
  for (const query of SOURCE_QUERIES) {
    let offset = 0;
    while (true) {
      const rows = await client.query<MappingSourceRow>(query, [
        batchSize,
        offset,
      ]);
      if (rows.rows.length === 0) break;
      await client.query('BEGIN');
      try {
        for (const row of rows.rows) await ensureMapping(client, row);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      mappedRows += rows.rows.length;
      offset += rows.rows.length;
      if (rows.rows.length < batchSize) break;
    }
  }
  return mappedRows;
}

async function ensureMapping(
  client: Pick<PoolClient, 'query'>,
  row: MappingSourceRow,
): Promise<void> {
  const video = canonicalizeYoutubeUrl(row.videoUrl);
  const source = await client.query<{ id: string }>(
    `INSERT INTO video_sources (
       provider, canonical_video_id, canonical_url,
       metadata
     ) VALUES ($1, $2, $3, '{}'::jsonb)
     ON CONFLICT (provider, canonical_video_id) DO UPDATE
     SET canonical_url = EXCLUDED.canonical_url,
         updated_at = statement_timestamp()
     RETURNING id::text AS id`,
    [video.provider, video.canonicalVideoId, video.canonicalUrl],
  );
  const videoSourceId = source.rows[0].id;
  const item = await client.query<{ id: string }>(
    `INSERT INTO learning_items (
       user_id, video_source_id, source_post_id, provenance
     ) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, video_source_id) DO UPDATE
     SET source_post_id = COALESCE(learning_items.source_post_id, EXCLUDED.source_post_id),
         updated_at = statement_timestamp()
     RETURNING id::text AS id`,
    [
      row.userId,
      videoSourceId,
      row.sourcePostId,
      JSON.stringify({ origin: row.entityKind, legacyId: row.legacyEntityId }),
    ],
  );
  const learningItemId = item.rows[0].id;
  const context =
    row.courseStepId === null
      ? await client.query<{ id: string }>(
          `INSERT INTO study_contexts (user_id, learning_item_id, kind, provenance)
           VALUES ($1, $2, 'standalone', $3::jsonb)
           ON CONFLICT (learning_item_id) WHERE kind = 'standalone' DO UPDATE
           SET updated_at = statement_timestamp()
           RETURNING id::text AS id`,
          [
            row.userId,
            learningItemId,
            JSON.stringify({
              origin: row.entityKind,
              legacyId: row.legacyEntityId,
            }),
          ],
        )
      : await client.query<{ id: string }>(
          `INSERT INTO study_contexts (
             user_id, learning_item_id, kind, course_step_id,
             course_step_provenance_id, provenance
           ) VALUES ($1, $2, 'course_occurrence', $3, $3, $4::jsonb)
           ON CONFLICT (user_id, course_step_id)
             WHERE course_step_id IS NOT NULL DO UPDATE
           SET learning_item_id = EXCLUDED.learning_item_id,
               course_step_provenance_id = EXCLUDED.course_step_provenance_id,
               updated_at = statement_timestamp()
           RETURNING id::text AS id`,
          [
            row.userId,
            learningItemId,
            row.courseStepId,
            JSON.stringify({
              origin: row.entityKind,
              legacyId: row.legacyEntityId,
            }),
          ],
        );
  const studyContextId = context.rows[0].id;

  await client.query(
    `INSERT INTO legacy_learning_context_mappings (
       entity_kind, legacy_entity_id, user_id, video_source_id,
       learning_item_id, study_context_id, provenance
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (entity_kind, legacy_entity_id, user_id) DO UPDATE
     SET video_source_id = EXCLUDED.video_source_id,
         learning_item_id = EXCLUDED.learning_item_id,
         study_context_id = EXCLUDED.study_context_id,
         legacy_exception_reason = NULL,
         provenance = EXCLUDED.provenance`,
    [
      row.entityKind,
      row.legacyEntityId,
      row.userId,
      videoSourceId,
      learningItemId,
      studyContextId,
      JSON.stringify({ migrationVersion: LEARNING_CUTOVER_MIGRATION_VERSION }),
    ],
  );
  await linkLegacyRow(client, row, videoSourceId, studyContextId);
}

async function linkLegacyRow(
  client: Pick<PoolClient, 'query'>,
  row: MappingSourceRow,
  videoSourceId: string,
  studyContextId: string,
): Promise<void> {
  if (row.entityKind === 'course_step') {
    await client.query(
      `UPDATE course_steps
       SET video_source_id = $2,
           learning_context_provenance = $3::jsonb
       WHERE id = $1
         AND (video_source_id IS DISTINCT FROM $2::bigint
           OR learning_context_provenance IS DISTINCT FROM $3::jsonb)`,
      [
        row.legacyEntityId,
        videoSourceId,
        JSON.stringify({
          migrationVersion: LEARNING_CUTOVER_MIGRATION_VERSION,
        }),
      ],
    );
  } else if (row.entityKind === 'learning_progress') {
    await client.query(
      `UPDATE learning_progress SET study_context_id = $2
       WHERE id = $1 AND study_context_id IS DISTINCT FROM $2::bigint`,
      [row.legacyEntityId, studyContextId],
    );
  } else if (row.entityKind === 'learning_progress_event') {
    await client.query(
      `UPDATE learning_progress_events SET study_context_id = $2
       WHERE id = $1 AND study_context_id IS DISTINCT FROM $2::bigint`,
      [row.legacyEntityId, studyContextId],
    );
  } else if (row.entityKind === 'quiz_attempt') {
    await client.query(
      `UPDATE quiz_attempts SET study_context_id = $2
       WHERE id = $1 AND study_context_id IS DISTINCT FROM $2::bigint`,
      [row.legacyEntityId, studyContextId],
    );
  }
}

async function startOrResumeRun(
  client: Pick<PoolClient, 'query'>,
  options: BackfillOptions,
): Promise<
  Pick<BackfillResult, 'runId' | 'writerRelease' | 'sourceWatermark'>
> {
  if (options.runId) {
    const existing = await requireRun(
      client,
      options.runId,
      options.writerRelease,
    );
    await client.query(
      `UPDATE learning_cutover_runs
       SET state = 'backfilling', diagnostics = '{}'::jsonb,
           updated_at = statement_timestamp()
       WHERE id = $1 AND state <> 'activated'`,
      [options.runId],
    );
    return { ...existing, writerRelease: options.writerRelease };
  }
  const runId = randomUUID();
  const sourceWatermark = await currentWatermark(client);
  await client.query(
    `INSERT INTO learning_cutover_runs (
       id, source_watermark, processed_watermark, writer_release,
       migration_version
     ) VALUES ($1, $2, $2, $3, $4)`,
    [
      runId,
      sourceWatermark,
      options.writerRelease,
      LEARNING_CUTOVER_MIGRATION_VERSION,
    ],
  );
  return { runId, writerRelease: options.writerRelease, sourceWatermark };
}

async function requireRun(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  writerRelease: string,
): Promise<{ runId: string; sourceWatermark: number }> {
  const result = await client.query<{
    sourceWatermark: string;
    writerRelease: string;
    state: string;
  }>(
    `SELECT source_watermark::text AS "sourceWatermark",
            writer_release AS "writerRelease", state
     FROM learning_cutover_runs WHERE id = $1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Learning cutover run not found');
  if (row.writerRelease !== writerRelease) {
    throw new Error('Learning cutover writer release mismatch');
  }
  if (row.state === 'activated') {
    throw new Error('Activated learning cutover run cannot be resumed');
  }
  return { runId, sourceWatermark: Number(row.sourceWatermark) };
}

async function currentWatermark(
  client: Pick<PoolClient, 'query'>,
): Promise<number> {
  const result = await client.query<{ watermark: string }>(
    `SELECT COALESCE(max(id), 0)::text AS watermark
     FROM learning_cutover_source_changes`,
  );
  return Number(result.rows[0]?.watermark ?? 0);
}

async function recordVerification(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  sourceWatermark: number,
  freezeWatermark: number,
  verification: LearningItemBackfillVerification,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE learning_cutover_runs
     SET state = 'aborted', processed_watermark = $3,
         source_count = $4, target_count = $5,
         source_fingerprint = $6, target_fingerprint = $7,
         diagnostics = $8::jsonb, updated_at = statement_timestamp()
     WHERE id = $1 AND source_watermark = $2`,
    [
      runId,
      sourceWatermark,
      freezeWatermark,
      verification.sourceCount,
      verification.targetCount,
      verification.sourceFingerprint,
      verification.targetFingerprint,
      JSON.stringify({ reason, ...verification }),
    ],
  );
}

async function markRunAborted(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE learning_cutover_runs
     SET state = 'aborted', diagnostics = $2::jsonb,
         updated_at = statement_timestamp()
     WHERE id = $1 AND state <> 'activated'`,
    [runId, JSON.stringify({ reason })],
  );
}

function assertBackfillOptions(options: BackfillOptions): void {
  if (
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 1_000
  ) {
    throw new Error('batchSize must be an integer from 1 through 1000');
  }
  if (!options.writerRelease.trim())
    throw new Error('writerRelease is required');
}

function assertActivationOptions(options: ActivationOptions): void {
  if (!options.runId.trim() || !options.writerRelease.trim()) {
    throw new Error('runId and writerRelease are required');
  }
  if (!Number.isSafeInteger(options.maxFreezeMs) || options.maxFreezeMs < 0) {
    throw new Error('maxFreezeMs must be a nonnegative integer');
  }
  if (options.skipDeltaCatchUpForTest && process.env.NODE_ENV !== 'test') {
    throw new Error('skipDeltaCatchUpForTest is available only in tests');
  }
}

function requiredEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const writerRelease = environment.LEARNING_CUTOVER_WRITER_RELEASE?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL must be set');
  if (!writerRelease)
    throw new Error('LEARNING_CUTOVER_WRITER_RELEASE must be set');
  return { databaseUrl, writerRelease };
}

async function main(): Promise<void> {
  const environment = requiredEnvironment();
  const pool = new Pool({ connectionString: environment.databaseUrl });
  try {
    const batchSize = Number(process.env.LEARNING_BACKFILL_BATCH_SIZE ?? 250);
    const run = await backfillLearningItems(pool, {
      batchSize,
      writerRelease: environment.writerRelease,
      runId: process.env.LEARNING_CUTOVER_RUN_ID?.trim() || undefined,
    });
    if (process.env.LEARNING_CUTOVER_ACTIVATE === 'true') {
      const activation = await activateLearningCutover(pool, {
        runId: run.runId,
        writerRelease: run.writerRelease,
        maxFreezeMs: Number(
          process.env.LEARNING_CUTOVER_MAX_FREEZE_MS ?? 30_000,
        ),
      });
      console.log(JSON.stringify({ run, activation }));
      if (!activation.activated) process.exitCode = 1;
    } else {
      console.log(JSON.stringify(run));
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
