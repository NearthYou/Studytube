import { Pool, type PoolClient } from 'pg';
import { CourseCutoverPolicy } from '../src/course/course-cutover.policy';
import {
  acquireCourseBackfillLock,
  type CourseCutoverMode,
  listLegacyPlaylistIds,
  parseCutoverMode,
  readCourseTarget,
  readLegacyPlaylist,
  releaseCourseBackfillLock,
  requireBackfillAuthorization,
  sourceFingerprint,
  synchronizeCourseSequences,
  targetFingerprint,
} from './course-migration.shared';

export interface CourseBackfillOptions {
  cutoverMode?: CourseCutoverMode;
  stopAfterCompletedPlaylists?: number;
}

export interface CourseBackfillResult {
  migrated: number;
  rebuilt: number;
  skipped: number;
}

interface AuditRow {
  sourceFingerprint: Buffer;
  targetFingerprint: Buffer;
}

export async function runCourseBackfill(
  pool: Pool,
  options: CourseBackfillOptions = {},
): Promise<CourseBackfillResult> {
  const cutoverMode =
    options.cutoverMode ?? parseCutoverMode(process.env.COURSE_CUTOVER_MODE);

  new CourseCutoverPolicy(cutoverMode).assertBackfillAllowed();

  validateStopLimit(options.stopAfterCompletedPlaylists);

  const client = await pool.connect();
  const result: CourseBackfillResult = { migrated: 0, rebuilt: 0, skipped: 0 };

  try {
    await acquireCourseBackfillLock(client);

    try {
      const playlistIds = await listLegacyPlaylistIds(client);

      for (const playlistId of playlistIds) {
        const outcome = await backfillPlaylist(client, playlistId);
        result[outcome] += 1;

        if (
          options.stopAfterCompletedPlaylists !== undefined &&
          result.migrated + result.rebuilt >=
            options.stopAfterCompletedPlaylists
        ) {
          throw new Error(
            `test interruption after ${options.stopAfterCompletedPlaylists} completed playlist`,
          );
        }
      }

      await client.query('BEGIN');

      try {
        await synchronizeCourseSequences(client);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      await releaseCourseBackfillLock(client);
    }
  } finally {
    client.release();
  }

  return result;
}

async function backfillPlaylist(
  client: PoolClient,
  playlistId: number,
): Promise<keyof CourseBackfillResult> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

  try {
    await client.query('SELECT id FROM playlists WHERE id = $1 FOR UPDATE', [
      playlistId,
    ]);
    const source = await readLegacyPlaylist(client, playlistId);

    if (!source) {
      await client.query('COMMIT');
      return 'skipped';
    }

    const auditResult = await client.query<AuditRow>(
      `
          SELECT source_fingerprint AS "sourceFingerprint",
                 target_fingerprint AS "targetFingerprint"
          FROM course_backfill_audits
          WHERE legacy_playlist_id = $1
        `,
      [playlistId],
    );
    const currentTarget = await readCourseTarget(client, playlistId);
    const audit = auditResult.rows[0];
    const currentSourceFingerprint = sourceFingerprint(source);
    const currentTargetFingerprint = currentTarget
      ? targetFingerprint(currentTarget)
      : null;

    if (
      audit &&
      audit.sourceFingerprint.equals(currentSourceFingerprint) &&
      currentTargetFingerprint &&
      audit.targetFingerprint.equals(currentTargetFingerprint)
    ) {
      await client.query('COMMIT');
      return 'skipped';
    }

    await client.query('DELETE FROM courses WHERE id = $1', [playlistId]);
    await insertCourseAggregate(client, source);
    const rebuiltTarget = await readCourseTarget(client, playlistId);

    if (!rebuiltTarget) {
      throw new Error(`Course ${playlistId} was not created`);
    }

    await client.query(
      `
        INSERT INTO course_backfill_audits (
          legacy_playlist_id, order_strategy, source_fingerprint,
          target_fingerprint, step_count, feedback_count, completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (legacy_playlist_id) DO UPDATE
        SET order_strategy = EXCLUDED.order_strategy,
            source_fingerprint = EXCLUDED.source_fingerprint,
            target_fingerprint = EXCLUDED.target_fingerprint,
            step_count = EXCLUDED.step_count,
            feedback_count = EXCLUDED.feedback_count,
            completed_at = EXCLUDED.completed_at
      `,
      [
        source.id,
        source.orderStrategy,
        currentSourceFingerprint,
        targetFingerprint(rebuiltTarget),
        source.items.length,
        source.feedback.length,
      ],
    );
    await client.query('COMMIT');

    return audit ? 'rebuilt' : 'migrated';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function insertCourseAggregate(
  client: PoolClient,
  source: NonNullable<Awaited<ReturnType<typeof readLegacyPlaylist>>>,
): Promise<void> {
  await client.query(
    `
      INSERT INTO courses (
        id, owner_id, title, description, visibility, status, version,
        idempotency_key_digest, idempotency_payload_hash,
        created_at, updated_at, published_at, archived_at
      )
      VALUES (
        $1, $2, $3, $4, 'private', 'draft', 1,
        NULL, NULL, $5::timestamptz, $5::timestamptz, NULL, NULL
      )
    `,
    [
      source.id,
      source.ownerId,
      source.title,
      source.description,
      source.createdAt,
    ],
  );

  for (const item of source.items) {
    await client.query(
      `
        INSERT INTO course_steps (
          course_id, source_post_id, position, title_snapshot,
          video_url_snapshot, thumbnail_url_snapshot,
          channel_name_snapshot, owner_learning_state
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)
      `,
      [
        source.id,
        item.postId,
        item.position,
        item.title,
        item.videoUrl,
        item.thumbnailUrl,
        item.channelName,
      ],
    );
  }

  for (const feedback of source.feedback) {
    await client.query(
      `
        INSERT INTO course_feedback (
          id, course_id, author_id, rating, body, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
      `,
      [
        feedback.id,
        source.id,
        feedback.authorId,
        feedback.rating,
        feedback.body,
        feedback.createdAt,
      ],
    );
  }
}

function validateStopLimit(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error('stopAfterCompletedPlaylists must be a positive integer');
  }
}

function testStopLimit(environment: NodeJS.ProcessEnv): number | undefined {
  const value = environment.COURSE_BACKFILL_TEST_STOP_AFTER?.trim();

  if (!value) {
    return undefined;
  }

  return Number(value);
}

async function main(): Promise<void> {
  const connectionString = requireBackfillAuthorization();
  const pool = new Pool({ connectionString });

  try {
    const result = await runCourseBackfill(pool, {
      cutoverMode: parseCutoverMode(process.env.COURSE_CUTOVER_MODE),
      stopAfterCompletedPlaylists: testStopLimit(process.env),
    });
    console.log(JSON.stringify(result));
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
