import { isDeepStrictEqual } from 'node:util';
import { Pool, type PoolClient } from 'pg';
import {
  acquireCourseBackfillLock,
  expectedCourseTarget,
  listLegacyPlaylistIds,
  readCourseSequenceStates,
  readCourseTarget,
  readLegacyPlaylist,
  releaseCourseBackfillLock,
  requireVerificationTarget,
  sourceFingerprint,
  targetFingerprint,
} from './course-migration.shared';

export interface CourseBackfillVerification {
  ok: boolean;
  playlistCount: number;
  diagnostics: string[];
}

interface AuditRow {
  orderStrategy: string;
  sourceFingerprint: Buffer;
  targetFingerprint: Buffer;
  stepCount: number;
  feedbackCount: number;
}

export async function verifyCourseBackfill(
  pool: Pool,
): Promise<CourseBackfillVerification> {
  const client = await pool.connect();

  try {
    await acquireCourseBackfillLock(client);

    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

      try {
        const result = await verifySnapshot(client);
        await client.query('COMMIT');
        return result;
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
}

async function verifySnapshot(
  client: PoolClient,
): Promise<CourseBackfillVerification> {
  const diagnostics: string[] = [];
  const playlistIds = await listLegacyPlaylistIds(client);
  const counts = await client.query<{
    playlists: number;
    courses: number;
    audits: number;
  }>(`
    SELECT (SELECT count(*) FROM playlists)::integer AS playlists,
           (SELECT count(*) FROM courses)::integer AS courses,
           (SELECT count(*) FROM course_backfill_audits)::integer AS audits
  `);
  const totals = counts.rows[0];

  if (!totals) {
    throw new Error('Unable to read Course migration counts');
  }

  if (totals.playlists !== totals.courses) {
    diagnostics.push(
      `root count mismatch: legacy=${totals.playlists} target=${totals.courses}`,
    );
  }

  if (totals.playlists !== totals.audits) {
    diagnostics.push(
      `audit count mismatch: legacy=${totals.playlists} audits=${totals.audits}`,
    );
  }

  await compareOwnerCounts(client, diagnostics);

  for (const playlistId of playlistIds) {
    await comparePlaylist(client, playlistId, diagnostics);
  }

  await findUnexpectedTargets(client, diagnostics);
  await verifySequenceStates(client, diagnostics);

  return {
    ok: diagnostics.length === 0,
    playlistCount: playlistIds.length,
    diagnostics,
  };
}

async function verifySequenceStates(
  client: PoolClient,
  diagnostics: string[],
): Promise<void> {
  const states = await readCourseSequenceStates(client);

  for (const state of states) {
    if (state.nextValue <= state.maximumId) {
      diagnostics.push(
        `${state.targetTable} sequence behind: next=${state.nextValue} maximum=${state.maximumId}`,
      );
    }
  }
}

async function comparePlaylist(
  client: PoolClient,
  playlistId: number,
  diagnostics: string[],
): Promise<void> {
  const source = await readLegacyPlaylist(client, playlistId);
  const target = await readCourseTarget(client, playlistId);
  const auditResult = await client.query<AuditRow>(
    `
        SELECT order_strategy AS "orderStrategy",
               source_fingerprint AS "sourceFingerprint",
               target_fingerprint AS "targetFingerprint",
               step_count AS "stepCount",
               feedback_count AS "feedbackCount"
        FROM course_backfill_audits
        WHERE legacy_playlist_id = $1
      `,
    [playlistId],
  );
  const audit = auditResult.rows[0];

  if (!source) {
    diagnostics.push(`playlist ${playlistId}: source disappeared`);
    return;
  }

  if (!target) {
    diagnostics.push(`playlist ${playlistId}: target Course missing`);
    return;
  }

  if (!audit) {
    diagnostics.push(`playlist ${playlistId}: audit missing`);
    return;
  }

  if (audit.orderStrategy !== source.orderStrategy) {
    diagnostics.push(
      `playlist ${playlistId}: order strategy mismatch expected=${source.orderStrategy} actual=${audit.orderStrategy}`,
    );
  }

  if (!audit.sourceFingerprint.equals(sourceFingerprint(source))) {
    diagnostics.push(`playlist ${playlistId}: source fingerprint stale`);
  }

  if (!audit.targetFingerprint.equals(targetFingerprint(target))) {
    diagnostics.push(`playlist ${playlistId}: target fingerprint stale`);
  }

  if (audit.stepCount !== source.items.length) {
    diagnostics.push(
      `playlist ${playlistId}: audit step count mismatch expected=${source.items.length} actual=${audit.stepCount}`,
    );
  }

  if (audit.feedbackCount !== source.feedback.length) {
    diagnostics.push(
      `playlist ${playlistId}: audit feedback count mismatch expected=${source.feedback.length} actual=${audit.feedbackCount}`,
    );
  }

  compareRoot(source, target, diagnostics);
  compareSteps(source, target, diagnostics);

  if (!isDeepStrictEqual(target.feedback, source.feedback)) {
    diagnostics.push(`playlist ${playlistId}: feedback mismatch`);
  }
}

function compareRoot(
  source: NonNullable<Awaited<ReturnType<typeof readLegacyPlaylist>>>,
  target: NonNullable<Awaited<ReturnType<typeof readCourseTarget>>>,
  diagnostics: string[],
): void {
  const expected = expectedCourseTarget(source);
  const actualRoot = {
    id: target.id,
    ownerId: target.ownerId,
    title: target.title,
    description: target.description,
    visibility: target.visibility,
    status: target.status,
    version: target.version,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    publishedAt: target.publishedAt,
    archivedAt: target.archivedAt,
    idempotencyKeyDigest: target.idempotencyKeyDigest,
    idempotencyPayloadHash: target.idempotencyPayloadHash,
  };
  const expectedRoot = {
    id: expected.id,
    ownerId: expected.ownerId,
    title: expected.title,
    description: expected.description,
    visibility: expected.visibility,
    status: expected.status,
    version: expected.version,
    createdAt: expected.createdAt,
    updatedAt: expected.updatedAt,
    publishedAt: expected.publishedAt,
    archivedAt: expected.archivedAt,
    idempotencyKeyDigest: expected.idempotencyKeyDigest,
    idempotencyPayloadHash: expected.idempotencyPayloadHash,
  };

  if (!isDeepStrictEqual(actualRoot, expectedRoot)) {
    diagnostics.push(`playlist ${source.id}: root mismatch`);
  }
}

function compareSteps(
  source: NonNullable<Awaited<ReturnType<typeof readLegacyPlaylist>>>,
  target: NonNullable<Awaited<ReturnType<typeof readCourseTarget>>>,
  diagnostics: string[],
): void {
  const expectedSteps = expectedCourseTarget(source).steps;
  const actualSteps = target.steps.map((step) => ({
    sourcePostId: step.sourcePostId,
    position: step.position,
    title: step.title,
    videoUrl: step.videoUrl,
    thumbnailUrl: step.thumbnailUrl,
    channelName: step.channelName,
    ownerLearningState: step.ownerLearningState,
  }));

  if (!isDeepStrictEqual(actualSteps, expectedSteps)) {
    diagnostics.push(`playlist ${source.id}: ordered snapshot mismatch`);
  }

  for (const [index, step] of target.steps.entries()) {
    if (!step.title.trim() || !step.videoUrl.trim()) {
      diagnostics.push(
        `playlist ${source.id}: step ${index + 1} required snapshot missing`,
      );
    }

    if (step.sourcePostId === null) {
      diagnostics.push(
        `playlist ${source.id}: step ${index + 1} source reference orphaned`,
      );
    }
  }
}

async function compareOwnerCounts(
  client: PoolClient,
  diagnostics: string[],
): Promise<void> {
  const result = await client.query<{
    ownerId: number;
    legacyCount: number;
    targetCount: number;
  }>(`
    WITH legacy AS (
      SELECT owner_id, count(*)::integer AS count
      FROM playlists
      GROUP BY owner_id
    ), target AS (
      SELECT owner_id, count(*)::integer AS count
      FROM courses
      GROUP BY owner_id
    )
    SELECT COALESCE(legacy.owner_id, target.owner_id) AS "ownerId",
           COALESCE(legacy.count, 0) AS "legacyCount",
           COALESCE(target.count, 0) AS "targetCount"
    FROM legacy
    FULL JOIN target USING (owner_id)
    WHERE COALESCE(legacy.count, 0) <> COALESCE(target.count, 0)
    ORDER BY COALESCE(legacy.owner_id, target.owner_id)
  `);

  for (const row of result.rows) {
    diagnostics.push(
      `owner ${row.ownerId}: root count mismatch legacy=${row.legacyCount} target=${row.targetCount}`,
    );
  }
}

async function findUnexpectedTargets(
  client: PoolClient,
  diagnostics: string[],
): Promise<void> {
  const result = await client.query<{ id: number; kind: string }>(`
    SELECT c.id, 'Course without legacy playlist' AS kind
    FROM courses c
    LEFT JOIN playlists p ON p.id = c.id
    WHERE p.id IS NULL
    UNION ALL
    SELECT a.legacy_playlist_id AS id, 'audit without legacy playlist' AS kind
    FROM course_backfill_audits a
    LEFT JOIN playlists p ON p.id = a.legacy_playlist_id
    WHERE p.id IS NULL
    ORDER BY id, kind
  `);

  for (const row of result.rows) {
    diagnostics.push(`${row.kind}: ${row.id}`);
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requireVerificationTarget() });

  try {
    const result = await verifyCourseBackfill(pool);
    console.log(JSON.stringify(result));

    if (!result.ok) {
      process.exitCode = 1;
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
