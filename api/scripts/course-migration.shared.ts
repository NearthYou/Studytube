import { createHash } from 'node:crypto';
import type { PoolClient, QueryResult } from 'pg';
import {
  COURSE_CUTOVER_ADVISORY_LOCK_KEY,
  resolveCourseCutoverMode,
  type CourseCutoverMode,
} from '../src/course/course-cutover.policy';

export type { CourseCutoverMode };
export type CourseOrderStrategy = 'legacy_position' | 'post_id_fallback';

export interface LegacyPlaylistSnapshot {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  createdAt: string;
  orderStrategy: CourseOrderStrategy;
  items: LegacyPlaylistItemSnapshot[];
  feedback: LegacyFeedbackSnapshot[];
}

export interface LegacyPlaylistItemSnapshot {
  postId: number;
  legacyPosition: number;
  position: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
}

export interface LegacyFeedbackSnapshot {
  id: number;
  authorId: number;
  rating: number;
  body: string;
  createdAt: string;
}

export interface CourseTargetSnapshot {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  visibility: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  idempotencyKeyDigest: string | null;
  idempotencyPayloadHash: string | null;
  steps: CourseTargetStepSnapshot[];
  feedback: LegacyFeedbackSnapshot[];
}

export interface CourseTargetStepSnapshot {
  id: string;
  sourcePostId: number | null;
  position: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  ownerLearningState: unknown;
}

export interface CourseSequenceState {
  targetTable: 'courses' | 'course_feedback';
  maximumId: number;
  nextValue: number;
}

interface PlaylistRootRow {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  createdAt: string;
}

interface PlaylistItemRow {
  postId: number;
  legacyPosition: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
}

interface CourseRootRow {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  visibility: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  idempotencyKeyDigest: string | null;
  idempotencyPayloadHash: string | null;
}

const timestampSql = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function parseCutoverMode(
  value: string | undefined,
  environment: string | undefined = process.env.NODE_ENV,
): CourseCutoverMode {
  return resolveCourseCutoverMode(value, environment);
}

export function requireBackfillAuthorization(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.ALLOW_COURSE_BACKFILL?.trim() !== 'true') {
    throw new Error('ALLOW_COURSE_BACKFILL must equal true');
  }

  const connectionString = environment.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error('DATABASE_URL must be set');
  }

  const mode = parseCutoverMode(
    environment.COURSE_CUTOVER_MODE,
    environment.NODE_ENV,
  );

  if (mode === 'course') {
    throw new Error('Course backfill is disabled in course cutover mode');
  }

  if (
    environment.COURSE_BACKFILL_TEST_STOP_AFTER &&
    environment.NODE_ENV !== 'test'
  ) {
    throw new Error(
      'COURSE_BACKFILL_TEST_STOP_AFTER is available only when NODE_ENV=test',
    );
  }

  return connectionString;
}

export function requireVerificationTarget(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const connectionString = environment.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error('DATABASE_URL must be set');
  }

  return connectionString;
}

export async function listLegacyPlaylistIds(
  client: Pick<PoolClient, 'query'>,
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    'SELECT id FROM playlists ORDER BY id',
  );

  return result.rows.map((row) => row.id);
}

export async function readLegacyPlaylist(
  client: Pick<PoolClient, 'query'>,
  playlistId: number,
): Promise<LegacyPlaylistSnapshot | null> {
  const root = await client.query<PlaylistRootRow>(
    `
      SELECT id, owner_id AS "ownerId", title, description,
             ${timestampSql('created_at')} AS "createdAt"
      FROM playlists
      WHERE id = $1
    `,
    [playlistId],
  );
  const playlist = root.rows[0];

  if (!playlist) {
    return null;
  }

  const itemsResult = await client.query<PlaylistItemRow>(
    `
        SELECT pi.post_id AS "postId",
               pi.position AS "legacyPosition",
               p.title,
               p.video_url AS "videoUrl",
               p.thumbnail_url AS "thumbnailUrl",
               p.channel_name AS "channelName"
        FROM playlist_items pi
        JOIN posts p ON p.id = pi.post_id
        WHERE pi.playlist_id = $1
        ORDER BY pi.post_id
      `,
    [playlistId],
  );
  const feedbackResult = await client.query<LegacyFeedbackSnapshot>(
    `
        SELECT id, author_id AS "authorId", rating, body,
               ${timestampSql('created_at')} AS "createdAt"
        FROM playlist_feedback
        WHERE playlist_id = $1
        ORDER BY id
      `,
    [playlistId],
  );
  const orderStrategy = chooseOrderStrategy(itemsResult.rows);
  const sortedItems = [...itemsResult.rows].sort((left, right) => {
    if (
      orderStrategy === 'legacy_position' &&
      left.legacyPosition !== right.legacyPosition
    ) {
      return left.legacyPosition - right.legacyPosition;
    }

    return left.postId - right.postId;
  });

  return {
    ...playlist,
    orderStrategy,
    items: sortedItems.map((item, index) => ({
      ...item,
      position: index + 1,
    })),
    feedback: feedbackResult.rows,
  };
}

export function chooseOrderStrategy(
  items: readonly Pick<PlaylistItemRow, 'legacyPosition'>[],
): CourseOrderStrategy {
  const positions = items
    .map((item) => item.legacyPosition)
    .sort((left, right) => left - right);
  const trustworthy = positions.every(
    (position, index) =>
      Number.isSafeInteger(position) && position === index + 1,
  );

  return trustworthy ? 'legacy_position' : 'post_id_fallback';
}

export async function readCourseTarget(
  client: Pick<PoolClient, 'query'>,
  courseId: number,
): Promise<CourseTargetSnapshot | null> {
  const root = await client.query<CourseRootRow>(
    `
      SELECT id, owner_id AS "ownerId", title, description, visibility,
             status, version,
             ${timestampSql('created_at')} AS "createdAt",
             ${timestampSql('updated_at')} AS "updatedAt",
             CASE WHEN published_at IS NULL THEN NULL
                  ELSE ${timestampSql('published_at')} END AS "publishedAt",
             CASE WHEN archived_at IS NULL THEN NULL
                  ELSE ${timestampSql('archived_at')} END AS "archivedAt",
             CASE WHEN idempotency_key_digest IS NULL THEN NULL
                  ELSE encode(idempotency_key_digest, 'hex') END
               AS "idempotencyKeyDigest",
             CASE WHEN idempotency_payload_hash IS NULL THEN NULL
                  ELSE encode(idempotency_payload_hash, 'hex') END
               AS "idempotencyPayloadHash"
      FROM courses
      WHERE id = $1
    `,
    [courseId],
  );
  const course = root.rows[0];

  if (!course) {
    return null;
  }

  const steps = await client.query<CourseTargetStepSnapshot>(
    `
        SELECT id::text AS id,
               source_post_id AS "sourcePostId",
               position,
               title_snapshot AS title,
               video_url_snapshot AS "videoUrl",
               thumbnail_url_snapshot AS "thumbnailUrl",
               channel_name_snapshot AS "channelName",
               owner_learning_state AS "ownerLearningState"
        FROM course_steps
        WHERE course_id = $1
        ORDER BY position, id
      `,
    [courseId],
  );
  const feedback = await client.query<LegacyFeedbackSnapshot>(
    `
        SELECT id, author_id AS "authorId", rating, body,
               ${timestampSql('created_at')} AS "createdAt"
        FROM course_feedback
        WHERE course_id = $1
        ORDER BY id
      `,
    [courseId],
  );

  return { ...course, steps: steps.rows, feedback: feedback.rows };
}

export function fingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

export function sourceFingerprint(source: LegacyPlaylistSnapshot): Buffer {
  return fingerprint(source);
}

export function targetFingerprint(target: CourseTargetSnapshot): Buffer {
  return fingerprint(target);
}

export function expectedCourseTarget(source: LegacyPlaylistSnapshot): Omit<
  CourseTargetSnapshot,
  'steps'
> & {
  steps: Omit<CourseTargetStepSnapshot, 'id'>[];
} {
  return {
    id: source.id,
    ownerId: source.ownerId,
    title: source.title,
    description: source.description,
    visibility: 'private',
    status: 'draft',
    version: 1,
    createdAt: source.createdAt,
    updatedAt: source.createdAt,
    publishedAt: null,
    archivedAt: null,
    idempotencyKeyDigest: null,
    idempotencyPayloadHash: null,
    steps: source.items.map((item) => ({
      sourcePostId: item.postId,
      position: item.position,
      title: item.title,
      videoUrl: item.videoUrl,
      thumbnailUrl: item.thumbnailUrl,
      channelName: item.channelName,
      ownerLearningState: {},
    })),
    feedback: source.feedback,
  };
}

export async function synchronizeCourseSequences(
  client: Pick<PoolClient, 'query'>,
): Promise<void> {
  await synchronizeSequence(client, 'courses', 'id', 'playlists');
  await synchronizeSequence(
    client,
    'course_feedback',
    'id',
    'playlist_feedback',
  );
}

export async function readCourseSequenceStates(
  client: Pick<PoolClient, 'query'>,
): Promise<CourseSequenceState[]> {
  return [
    await readSequenceState(client, 'courses', 'id', 'playlists'),
    await readSequenceState(
      client,
      'course_feedback',
      'id',
      'playlist_feedback',
    ),
  ];
}

async function synchronizeSequence(
  client: Pick<PoolClient, 'query'>,
  targetTable: 'courses' | 'course_feedback',
  targetColumn: 'id',
  legacyTable: 'playlists' | 'playlist_feedback',
): Promise<void> {
  const state = await readSequenceState(
    client,
    targetTable,
    targetColumn,
    legacyTable,
  );

  if (state.maximumId >= state.nextValue && state.maximumId > 0) {
    const sequenceName = await findSequenceName(
      client,
      targetTable,
      targetColumn,
    );
    await client.query('SELECT setval($1::regclass, $2, true)', [
      sequenceName,
      state.maximumId,
    ]);
  }
}

async function readSequenceState(
  client: Pick<PoolClient, 'query'>,
  targetTable: 'courses' | 'course_feedback',
  targetColumn: 'id',
  legacyTable: 'playlists' | 'playlist_feedback',
): Promise<CourseSequenceState> {
  const sequenceResult = await client.query<{
    sequenceName: string | null;
    maximumId: string;
  }>(
    `
      SELECT pg_get_serial_sequence($1, $2) AS "sequenceName",
             GREATEST(
               COALESCE((SELECT max(id) FROM ${targetTable}), 0),
               COALESCE((SELECT max(id) FROM ${legacyTable}), 0)
             )::text AS "maximumId"
    `,
    [targetTable, targetColumn],
  );
  const sequence = sequenceResult.rows[0];

  if (!sequence?.sequenceName) {
    throw new Error(`No sequence found for ${targetTable}.${targetColumn}`);
  }

  const state = await client.query<{ lastValue: string; isCalled: boolean }>(
    `
      SELECT last_value::text AS "lastValue", is_called AS "isCalled"
      FROM ${qualifiedSequenceReference(sequence.sequenceName)}
    `,
  );
  const current = state.rows[0];
  const maximumId = Number(sequence.maximumId);
  const lastValue = Number(current?.lastValue);

  if (!Number.isSafeInteger(maximumId) || maximumId < 0) {
    throw new Error(`Invalid maximum ID for ${targetTable}.${targetColumn}`);
  }

  if (!Number.isSafeInteger(lastValue) || lastValue < 0) {
    throw new Error(
      `Invalid sequence state for ${targetTable}.${targetColumn}`,
    );
  }

  const nextValue = current?.isCalled ? lastValue + 1 : lastValue;

  return { targetTable, maximumId, nextValue };
}

async function findSequenceName(
  client: Pick<PoolClient, 'query'>,
  targetTable: 'courses' | 'course_feedback',
  targetColumn: 'id',
): Promise<string> {
  const result = await client.query<{ sequenceName: string | null }>(
    'SELECT pg_get_serial_sequence($1, $2) AS "sequenceName"',
    [targetTable, targetColumn],
  );
  const sequenceName = result.rows[0]?.sequenceName;

  if (!sequenceName) {
    throw new Error(`No sequence found for ${targetTable}.${targetColumn}`);
  }

  return sequenceName;
}

function qualifiedSequenceReference(sequenceName: string): string {
  return sequenceName
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.');
}

export async function acquireCourseBackfillLock(
  client: Pick<PoolClient, 'query'>,
): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1::bigint)', [
    COURSE_CUTOVER_ADVISORY_LOCK_KEY,
  ]);
}

export async function releaseCourseBackfillLock(
  client: Pick<PoolClient, 'query'>,
): Promise<void> {
  const result: QueryResult<{ unlocked: boolean }> = await client.query(
    'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
    [COURSE_CUTOVER_ADVISORY_LOCK_KEY],
  );

  if (result.rows[0]?.unlocked !== true) {
    throw new Error('Course backfill advisory lock was not held');
  }
}
