import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { canonicalizeYoutubeUrl } from '../src/learning/youtube-url.policy';

const MAPPING_KINDS = [
  'post',
  'course_step',
  'learning_progress',
  'learning_progress_event',
  'quiz_attempt',
] as const;

type MappingKind = (typeof MAPPING_KINDS)[number];

interface SourceRow {
  entityKind: MappingKind;
  legacyEntityId: string;
  userId: number;
  videoUrl: string;
  courseStepId: string | null;
}

interface TargetRow {
  entityKind: MappingKind;
  legacyEntityId: string;
  mappingUserId: number;
  videoSourceId: string | null;
  learningItemId: string | null;
  studyContextId: string | null;
  canonicalVideoId: string | null;
  itemUserId: number | null;
  contextUserId: number | null;
  contextLearningItemId: string | null;
  courseStepId: string | null;
}

interface FingerprintRow {
  entityKind: MappingKind;
  legacyEntityId: string;
  userId: number;
  canonicalVideoId: string;
  courseStepId: string | null;
}

export interface LearningItemBackfillVerification {
  ok: boolean;
  sourceCount: number;
  targetCount: number;
  sourceFingerprint: string;
  targetFingerprint: string;
  duplicateMappings: number;
  ownerMismatches: number;
  orphans: number;
}

export async function verifyLearningItemBackfill(
  pool: Pick<Pool, 'connect'>,
): Promise<LearningItemBackfillVerification> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const result = await verifyLearningItemBackfillSnapshot(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function verifyLearningItemBackfillSnapshot(
  client: Pick<PoolClient, 'query'>,
): Promise<LearningItemBackfillVerification> {
  const sources = await readSources(client);
  const sourceRows = sources.map(normalizeSource);
  const targetResult = await client.query<TargetRow>(
    `
    SELECT mapping.entity_kind AS "entityKind",
           mapping.legacy_entity_id AS "legacyEntityId",
           mapping.user_id AS "mappingUserId",
           mapping.video_source_id::text AS "videoSourceId",
           mapping.learning_item_id::text AS "learningItemId",
           mapping.study_context_id::text AS "studyContextId",
           source.canonical_video_id AS "canonicalVideoId",
           item.user_id AS "itemUserId",
           context.user_id AS "contextUserId",
           context.learning_item_id::text AS "contextLearningItemId",
           context.course_step_provenance_id::text AS "courseStepId"
    FROM legacy_learning_context_mappings AS mapping
    LEFT JOIN video_sources AS source ON source.id = mapping.video_source_id
    LEFT JOIN learning_items AS item ON item.id = mapping.learning_item_id
    LEFT JOIN study_contexts AS context ON context.id = mapping.study_context_id
    WHERE mapping.entity_kind = ANY($1::text[])
    ORDER BY mapping.entity_kind, mapping.legacy_entity_id, mapping.user_id
  `,
    [MAPPING_KINDS],
  );
  const targetRows = targetResult.rows;
  const targetFingerprintRows: FingerprintRow[] = targetRows
    .filter(
      (row): row is TargetRow & { canonicalVideoId: string } =>
        row.canonicalVideoId !== null,
    )
    .map((row) => ({
      entityKind: row.entityKind,
      legacyEntityId: row.legacyEntityId,
      userId: row.mappingUserId,
      canonicalVideoId: row.canonicalVideoId,
      courseStepId: row.courseStepId,
    }));
  const sourceKeys = new Set(sourceRows.map(mappingKey));
  const targetKeys = new Set(targetFingerprintRows.map(mappingKey));
  const duplicateMappings = targetRows.length - targetKeys.size;
  const ownerMismatches = targetRows.filter(
    (row) =>
      row.itemUserId !== row.mappingUserId ||
      row.contextUserId !== row.mappingUserId ||
      row.contextLearningItemId !== row.learningItemId,
  ).length;
  const orphans = targetRows.filter(
    (row) =>
      row.videoSourceId === null ||
      row.learningItemId === null ||
      row.studyContextId === null ||
      row.canonicalVideoId === null ||
      !sourceKeys.has(
        mappingKey({
          entityKind: row.entityKind,
          legacyEntityId: row.legacyEntityId,
          userId: row.mappingUserId,
          canonicalVideoId: row.canonicalVideoId ?? '',
          courseStepId: row.courseStepId,
        }),
      ),
  ).length;
  const sourceFingerprint = fingerprint(sourceRows);
  const targetFingerprint = fingerprint(targetFingerprintRows);
  const sourceCount = sourceRows.length;
  const targetCount = targetRows.length;
  const ok =
    sourceCount === targetCount &&
    sourceFingerprint === targetFingerprint &&
    duplicateMappings === 0 &&
    ownerMismatches === 0 &&
    orphans === 0;

  return {
    ok,
    sourceCount,
    targetCount,
    sourceFingerprint,
    targetFingerprint,
    duplicateMappings,
    ownerMismatches,
    orphans,
  };
}

async function readSources(
  client: Pick<PoolClient, 'query'>,
): Promise<SourceRow[]> {
  const result = await client.query<SourceRow>(`
    SELECT 'post'::text AS "entityKind", post.id::text AS "legacyEntityId",
           post.author_id AS "userId", post.video_url AS "videoUrl",
           NULL::text AS "courseStepId"
    FROM posts AS post
    UNION ALL
    SELECT 'course_step', step.id::text, course.owner_id,
           step.video_url_snapshot, step.id::text
    FROM course_steps AS step
    JOIN courses AS course ON course.id = step.course_id
    UNION ALL
    SELECT 'learning_progress', progress.id::text, progress.user_id,
           step.video_url_snapshot, step.id::text
    FROM learning_progress AS progress
    JOIN course_steps AS step ON step.id = progress.course_step_id
    UNION ALL
    SELECT 'learning_progress_event', event.id::text, event.user_id,
           step.video_url_snapshot, step.id::text
    FROM learning_progress_events AS event
    JOIN course_steps AS step ON step.id = event.course_step_id
    UNION ALL
    SELECT 'quiz_attempt', attempt.id::text, attempt.user_id,
           step.video_url_snapshot, step.id::text
    FROM quiz_attempts AS attempt
    JOIN quizzes AS quiz ON quiz.id = attempt.quiz_id
    JOIN course_steps AS step ON step.id = quiz.course_step_id
    ORDER BY 1, 2, 3
  `);
  return result.rows;
}

function normalizeSource(row: SourceRow): FingerprintRow {
  const video = canonicalizeYoutubeUrl(row.videoUrl);
  return {
    entityKind: row.entityKind,
    legacyEntityId: row.legacyEntityId,
    userId: row.userId,
    canonicalVideoId: video.canonicalVideoId,
    courseStepId: row.courseStepId,
  };
}

function mappingKey(row: FingerprintRow): string {
  return [
    row.entityKind,
    row.legacyEntityId,
    row.userId,
    row.canonicalVideoId,
    row.courseStepId ?? '',
  ].join(':');
}

function fingerprint(rows: FingerprintRow[]): string {
  const normalized = [...rows].sort((left, right) =>
    mappingKey(left).localeCompare(mappingKey(right)),
  );
  return createHash('sha256')
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex');
}

function requiredDatabaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL must be set');
  return value;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requiredDatabaseUrl() });
  try {
    const result = await verifyLearningItemBackfill(pool);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
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
