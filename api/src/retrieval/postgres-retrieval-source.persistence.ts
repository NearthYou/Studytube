import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RemoveMissingSourceChunksOutcome } from './retrieval.repository';
import type {
  ReplaceRetrievalChunks,
  ReplaceRetrievalChunksOutcome,
  RetrievalSourceKind,
  RetrievalSourceReference,
  RetrievalSourceSnapshot,
  RetrievalTranscriptSegment,
  RetrievalVisibility,
  CaptureLearningRetrievalContext,
  LearningEvidenceItem,
  LearningRetrievalContextSnapshot,
} from './retrieval.types';
import { RetrievalSourceInvariantError } from './retrieval.errors';
import {
  canonicalPositiveId,
  embeddingLiteral,
} from './postgres-retrieval.values';

type SnapshotRow = {
  sourceId: string;
  sourceVersion: string;
  ownerId: number;
  visibility: RetrievalVisibility;
  title: string;
  summary: string;
  translatedNotes: string;
  tags: unknown;
  sourceUrl: string;
  transcriptBody: string;
  sourceSegments: unknown;
  translatedSegments: unknown;
  evidenceItems?: unknown;
};

type LearningContextSnapshotRow = {
  agentRunId: string;
  ownerId: number;
  studyContextId: string;
  learningItemId: string;
  videoSourceId: string;
  courseId: number | null;
  profileGoal: string;
  watchedRanges: unknown;
  captionArtifactId: string;
  captionGeneration: number;
  contextRetrievalVersion: string;
};

type CurrentSourceRow = {
  sourceVersion: string;
  ownerId: number;
  visibility: RetrievalVisibility;
};

type ExistingChunkRow = {
  chunkIndex: number;
  startSeconds: number | null;
  endSeconds: number | null;
  sourceVersion: string;
  contentHash: Buffer;
};

export class PostgresRetrievalSourcePersistence {
  constructor(private readonly pool: Pool) {}

  async captureLearningContext(
    input: CaptureLearningRetrievalContext,
  ): Promise<LearningRetrievalContextSnapshot> {
    const ownerId = positiveOwnerId(input.ownerId);
    const studyContextId = canonicalPositiveId(input.studyContextId);
    const watchedRanges = normalizeWatchedRanges(input.watchedRanges);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.agentRunId,
      )
    ) {
      throw new RangeError('Agent run ID must be a canonical UUID');
    }
    const result = await this.pool.query<LearningContextSnapshotRow>(
      CAPTURE_LEARNING_CONTEXT_SQL,
      [
        input.agentRunId,
        ownerId,
        studyContextId,
        JSON.stringify(watchedRanges),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new RetrievalSourceInvariantError(
        'Learning retrieval context is unavailable or not owned',
      );
    }
    return learningContextSnapshot(row);
  }

  async readSnapshot(
    source: RetrievalSourceReference,
  ): Promise<RetrievalSourceSnapshot | null> {
    const sourceKind = canonicalSourceKind(source.sourceKind);
    const sourceId = canonicalPositiveId(source.sourceId);
    const result = await this.pool.query<SnapshotRow>(
      sourceKind === 'post'
        ? POST_SNAPSHOT_SQL
        : sourceKind === 'course_step'
          ? COURSE_STEP_SNAPSHOT_SQL
          : LEARNING_CONTEXT_SNAPSHOT_SQL,
      [sourceId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      sourceKind,
      sourceId: String(row.sourceId),
      sourceVersion: String(row.sourceVersion),
      ownerId: Number(row.ownerId),
      visibility: row.visibility,
      title: row.title,
      summary: row.summary,
      translatedNotes: row.translatedNotes,
      tags: stringArray(row.tags),
      sourceUrl: row.sourceUrl,
      transcriptBody: row.transcriptBody,
      sourceSegments: transcriptSegments(row.sourceSegments),
      translatedSegments: transcriptSegments(row.translatedSegments),
      evidenceItems: learningEvidenceItems(row.evidenceItems),
    };
  }

  async replaceChunks(
    input: ReplaceRetrievalChunks,
  ): Promise<ReplaceRetrievalChunksOutcome> {
    const normalized = normalizeChunkReplacement(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${normalized.sourceKind}:${normalized.sourceId}`],
      );

      const current = await readCurrentSource(
        client,
        normalized.sourceKind,
        normalized.sourceId,
      );
      if (!current) {
        await deleteSourceModelChunks(client, normalized);
        await client.query('COMMIT');
        return 'superseded';
      }

      const expectedVersion = BigInt(normalized.sourceVersion);
      const currentVersion = BigInt(current.sourceVersion);
      if (currentVersion > expectedVersion) {
        await client.query('COMMIT');
        return 'superseded';
      }
      if (currentVersion < expectedVersion) {
        throw new RetrievalSourceInvariantError(
          'Retrieval source version is ahead of the authoritative source',
        );
      }
      if (
        current.ownerId !== normalized.ownerId ||
        current.visibility !== normalized.visibility
      ) {
        throw new RetrievalSourceInvariantError(
          'Retrieval ownership or visibility does not match the source',
        );
      }

      const existing = await client.query<ExistingChunkRow>(
        `
          SELECT chunk_index AS "chunkIndex",
                 start_seconds AS "startSeconds",
                 end_seconds AS "endSeconds",
                 source_version::text AS "sourceVersion",
                 content_hash AS "contentHash"
          FROM retrieval_embeddings
          WHERE source_kind = $1
            AND source_id = $2::bigint
            AND model = $3
          ORDER BY chunk_index
          FOR UPDATE
        `,
        [normalized.sourceKind, normalized.sourceId, normalized.model],
      );
      const sameVersion = existing.rows.filter(
        (row) => BigInt(row.sourceVersion) === expectedVersion,
      );
      if (sameVersion.length > 0) {
        if (
          sameVersion.length === existing.rows.length &&
          sameChunkContentSet(sameVersion, normalized)
        ) {
          await client.query('COMMIT');
          return 'stored';
        }
        throw new RetrievalSourceInvariantError(
          'The same source version has a different retrieval chunk set',
        );
      }
      if (
        existing.rows.some((row) => BigInt(row.sourceVersion) > expectedVersion)
      ) {
        await client.query('COMMIT');
        return 'superseded';
      }

      await deleteSourceModelChunks(client, normalized);
      for (const chunk of normalized.chunks) {
        const contentHash = createHash('sha256')
          .update(chunk.content, 'utf8')
          .digest();
        await client.query(
          `
            INSERT INTO retrieval_embeddings (
              source_kind,
              source_id,
              owner_id,
              visibility,
              model,
              content,
              content_hash,
              source_url,
              embedding,
              timestamp_seconds,
              chunk_index,
              start_seconds,
              end_seconds,
              source_version,
              evidence_kind,
              resource_id,
              readiness,
              evidence_artifact_id,
              evidence_segment_id,
              evidence_note_id,
              evidence_quiz_attempt_id,
              artifact_generation
            )
            VALUES (
              $1, $2::bigint, $3, $4, $5, $6, $7, $8, $9::vector,
              $10, $11, $10, $12, $13::bigint,
              $14, $15, $16, $17::bigint, $18::bigint, $19::bigint,
              $20::uuid, $21
            )
          `,
          [
            normalized.sourceKind,
            normalized.sourceId,
            normalized.ownerId,
            normalized.visibility,
            normalized.model,
            chunk.content,
            contentHash,
            chunk.sourceUrl,
            embeddingLiteral(chunk.embedding),
            chunk.startSeconds,
            chunk.chunkIndex,
            chunk.endSeconds,
            normalized.sourceVersion,
            chunk.evidenceKind ?? null,
            chunk.resourceId ?? null,
            chunk.readiness ?? null,
            chunk.evidenceArtifactId ?? null,
            chunk.evidenceSegmentId ?? null,
            chunk.evidenceNoteId ?? null,
            chunk.evidenceQuizAttemptId ?? null,
            chunk.artifactGeneration ?? null,
          ],
        );
      }
      await client.query('COMMIT');
      return 'stored';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMissingChunks(
    source: RetrievalSourceReference,
  ): Promise<RemoveMissingSourceChunksOutcome> {
    const sourceKind = canonicalSourceKind(source.sourceKind);
    const sourceId = canonicalPositiveId(source.sourceId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${sourceKind}:${sourceId}`],
      );

      const current = await readCurrentSource(client, sourceKind, sourceId);
      if (current) {
        await client.query('COMMIT');
        return 'superseded';
      }

      await deleteAllSourceChunks(client, { sourceKind, sourceId });
      await client.query('COMMIT');
      return 'removed';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const POST_SNAPSHOT_SQL = `
  SELECT post.id::text AS "sourceId",
         post.retrieval_version::text AS "sourceVersion",
         post.author_id AS "ownerId",
         'public'::text AS visibility,
         post.title,
         post.summary,
         post.translated_notes AS "translatedNotes",
         COALESCE(post_tags.tags, ARRAY[]::text[]) AS tags,
         post.video_url AS "sourceUrl",
         COALESCE(asset.transcript_body, '') AS "transcriptBody",
         COALESCE(asset.source_segments, '[]'::jsonb) AS "sourceSegments",
         COALESCE(asset.translated_segments, '[]'::jsonb) AS "translatedSegments"
  FROM posts AS post
  LEFT JOIN LATERAL (
    SELECT array_agg(tag.name ORDER BY tag.name) AS tags
    FROM post_tags
    JOIN tags AS tag ON tag.id = post_tags.tag_id
    WHERE post_tags.post_id = post.id
  ) AS post_tags ON true
  LEFT JOIN LATERAL (
    SELECT video_asset.transcript_body,
           video_asset.source_segments,
           video_asset.translated_segments
    FROM video_assets AS video_asset
    WHERE video_asset.post_id = post.id
    ORDER BY video_asset.updated_at DESC, video_asset.id DESC
    LIMIT 1
  ) AS asset ON true
  WHERE post.id = $1::bigint
`;

const COURSE_STEP_SNAPSHOT_SQL = `
  SELECT step.id::text AS "sourceId",
         course.version::text AS "sourceVersion",
         course.owner_id AS "ownerId",
         course.visibility,
         step.title_snapshot AS title,
         COALESCE(post.summary, '') AS summary,
         COALESCE(post.translated_notes, '') AS "translatedNotes",
         COALESCE(post_tags.tags, ARRAY[]::text[]) AS tags,
         step.video_url_snapshot AS "sourceUrl",
         COALESCE(asset.transcript_body, '') AS "transcriptBody",
         COALESCE(asset.source_segments, '[]'::jsonb) AS "sourceSegments",
         COALESCE(asset.translated_segments, '[]'::jsonb) AS "translatedSegments"
  FROM course_steps AS step
  JOIN courses AS course ON course.id = step.course_id
  LEFT JOIN posts AS post ON post.id = step.source_post_id
  LEFT JOIN LATERAL (
    SELECT array_agg(tag.name ORDER BY tag.name) AS tags
    FROM post_tags
    JOIN tags AS tag ON tag.id = post_tags.tag_id
    WHERE post_tags.post_id = post.id
  ) AS post_tags ON true
  LEFT JOIN LATERAL (
    SELECT video_asset.transcript_body,
           video_asset.source_segments,
           video_asset.translated_segments
    FROM video_assets AS video_asset
    WHERE video_asset.post_id = post.id
    ORDER BY video_asset.updated_at DESC, video_asset.id DESC
    LIMIT 1
  ) AS asset ON true
  WHERE step.id = $1::bigint
    AND (
      (course.status = 'draft' AND course.visibility = 'private')
      OR (course.status = 'published' AND course.visibility = 'public')
    )
`;

const CAPTURE_LEARNING_CONTEXT_SQL = `
  WITH captured AS (
    INSERT INTO learning_retrieval_context_snapshots (
      agent_run_id, owner_id, study_context_id, learning_item_id,
      video_source_id, course_id, profile_goal, watched_ranges,
      caption_artifact_id, caption_generation
      , context_retrieval_version
    )
    SELECT $1::uuid,
           context.user_id,
           context.id,
           context.learning_item_id,
           item.video_source_id,
           course.id,
           COALESCE(account.preferences->>'goal', ''),
           $4::jsonb,
           artifact.id,
           artifact.generation,
           context.retrieval_version
    FROM agent_runs AS run
    JOIN users AS account ON account.id = run.owner_id
    JOIN study_contexts AS context ON context.id = $3::bigint
      AND context.user_id = run.owner_id
    JOIN learning_items AS item ON item.id = context.learning_item_id
      AND item.user_id = context.user_id
    LEFT JOIN course_steps AS step ON step.id = context.course_step_id
    LEFT JOIN courses AS course ON course.id = step.course_id
      AND course.owner_id = context.user_id
    JOIN caption_artifacts AS artifact ON artifact.id = COALESCE(
      context.current_translation_caption_artifact_id,
      context.current_source_caption_artifact_id
    )
      AND artifact.video_source_id = item.video_source_id
    JOIN caption_generation_states AS state ON state.artifact_id = artifact.id
      AND state.status = 'ready'
    WHERE run.id = $1::uuid AND run.owner_id = $2
    ON CONFLICT (agent_run_id) DO NOTHING
    RETURNING *
  )
  SELECT snapshot.agent_run_id AS "agentRunId",
         snapshot.owner_id AS "ownerId",
         snapshot.study_context_id::text AS "studyContextId",
         snapshot.learning_item_id::text AS "learningItemId",
         snapshot.video_source_id::text AS "videoSourceId",
         snapshot.course_id AS "courseId",
         snapshot.profile_goal AS "profileGoal",
         snapshot.watched_ranges AS "watchedRanges",
         snapshot.caption_artifact_id::text AS "captionArtifactId",
         snapshot.caption_generation AS "captionGeneration"
         , snapshot.context_retrieval_version::text AS "contextRetrievalVersion"
  FROM (
    SELECT * FROM captured
    UNION ALL
    SELECT existing.*
    FROM learning_retrieval_context_snapshots AS existing
    WHERE existing.agent_run_id = $1::uuid
      AND NOT EXISTS (SELECT 1 FROM captured)
  ) AS snapshot
  WHERE snapshot.agent_run_id = $1::uuid
    AND snapshot.owner_id = $2
    AND snapshot.study_context_id = $3::bigint
    AND snapshot.watched_ranges = $4::jsonb
`;

const LEARNING_CONTEXT_SNAPSHOT_SQL = `
  WITH owned_context AS (
    SELECT context.id,
           context.user_id,
           context.learning_item_id,
           context.retrieval_version,
           item.video_source_id,
           source.canonical_url,
           COALESCE(source.metadata->>'title', source.canonical_video_id) AS title,
           COALESCE(account.preferences->>'goal', '') AS profile_goal,
           COALESCE(
             context.current_translation_caption_artifact_id,
             context.current_source_caption_artifact_id
           ) AS artifact_id
    FROM study_contexts AS context
    JOIN learning_items AS item ON item.id = context.learning_item_id
      AND item.user_id = context.user_id
    JOIN video_sources AS source ON source.id = item.video_source_id
    JOIN users AS account ON account.id = context.user_id
    WHERE context.id = $1::bigint
  ), current_artifact AS (
    SELECT artifact.id, artifact.generation, artifact.video_source_id,
           state.status
    FROM caption_artifacts AS artifact
    JOIN caption_generation_states AS state ON state.artifact_id = artifact.id
    JOIN owned_context AS owned ON owned.artifact_id = artifact.id
      AND owned.video_source_id = artifact.video_source_id
    WHERE state.status IN ('partial', 'ready')
  ), evidence AS (
    SELECT 'caption_segment'::text AS kind,
           'caption-segment:' || segment.id::text AS resource_id,
           segment.text AS content,
           floor(segment.start_seconds)::integer AS start_seconds,
           ceil(segment.end_seconds)::integer AS end_seconds,
           owned.canonical_url || '?t=' || floor(segment.start_seconds)::integer || 's' AS source_url,
           artifact.status AS readiness,
           artifact.id::text AS artifact_id,
           segment.id::text AS segment_id,
           NULL::text AS note_id,
           NULL::text AS quiz_attempt_id,
           artifact.generation AS artifact_generation
    FROM owned_context AS owned
    JOIN current_artifact AS artifact ON true
    JOIN caption_artifact_segments AS segment ON segment.artifact_id = artifact.id
    UNION ALL
    SELECT 'learning_note',
           'learning-note:' || note.id::text,
           note.body,
           floor(note.position_seconds)::integer,
           floor(note.position_seconds)::integer + 1,
           owned.canonical_url || '?t=' || floor(note.position_seconds)::integer || 's',
           'ready',
           NULL,
           NULL,
           note.id::text,
           NULL,
           artifact.generation
    FROM owned_context AS owned
    JOIN current_artifact AS artifact ON true
    JOIN learning_notes AS note ON note.study_context_id = owned.id
      AND note.user_id = owned.user_id
    UNION ALL
    SELECT 'quiz_outcome',
           'quiz-attempt:' || attempt.id::text,
           '퀴즈 점수 ' || attempt.score::text || '점. ' ||
             COALESCE(string_agg(
               question.prompt || ' ' || question.explanation,
               ' ' ORDER BY question.position
             ), ''),
           COALESCE(min(question.source_start_seconds), 0),
           GREATEST(COALESCE(max(question.source_end_seconds), 1), 1),
           owned.canonical_url || '?t=' || COALESCE(min(question.source_start_seconds), 0) || 's',
           'ready',
           NULL,
           NULL,
           NULL,
           attempt.id::text,
           artifact.generation
    FROM owned_context AS owned
    JOIN current_artifact AS artifact ON true
    JOIN quiz_attempts AS attempt ON attempt.study_context_id = owned.id
      AND attempt.user_id = owned.user_id
    JOIN quizzes AS quiz ON quiz.id = attempt.quiz_id
    LEFT JOIN quiz_questions AS question ON question.quiz_id = quiz.id
    GROUP BY owned.canonical_url, artifact.generation, attempt.id, attempt.score
  )
  SELECT owned.id::text AS "sourceId",
         owned.retrieval_version::text AS "sourceVersion",
         owned.user_id AS "ownerId",
         'private'::text AS visibility,
         owned.title,
         owned.profile_goal AS summary,
         ''::text AS "translatedNotes",
         ARRAY[]::text[] AS tags,
         owned.canonical_url AS "sourceUrl",
         ''::text AS "transcriptBody",
         '[]'::jsonb AS "sourceSegments",
         '[]'::jsonb AS "translatedSegments",
         COALESCE(jsonb_agg(
           jsonb_build_object(
             'kind', evidence.kind,
             'resourceId', evidence.resource_id,
             'content', evidence.content,
             'startSeconds', evidence.start_seconds,
             'endSeconds', evidence.end_seconds,
             'sourceUrl', evidence.source_url,
             'readiness', evidence.readiness,
             'artifactId', evidence.artifact_id,
             'segmentId', evidence.segment_id,
             'noteId', evidence.note_id,
             'quizAttemptId', evidence.quiz_attempt_id,
             'artifactGeneration', evidence.artifact_generation
           ) ORDER BY evidence.start_seconds, evidence.kind, evidence.resource_id
         ) FILTER (WHERE evidence.resource_id IS NOT NULL), '[]'::jsonb) AS "evidenceItems"
  FROM owned_context AS owned
  JOIN current_artifact AS artifact ON true
  LEFT JOIN evidence ON true
  GROUP BY owned.id, owned.retrieval_version, owned.user_id, owned.title,
           owned.profile_goal, owned.canonical_url
`;

async function readCurrentSource(
  client: PoolClient,
  sourceKind: RetrievalSourceKind,
  sourceId: string,
): Promise<CurrentSourceRow | null> {
  let sql: string;
  if (sourceKind === 'post') {
    sql = `
          SELECT retrieval_version::text AS "sourceVersion",
                 author_id AS "ownerId",
                 'public'::text AS visibility
          FROM posts
          WHERE id = $1::bigint
          FOR SHARE
        `;
  } else if (sourceKind === 'course_step') {
    sql = `
          SELECT course.version::text AS "sourceVersion",
                 course.owner_id AS "ownerId",
                 course.visibility
          FROM course_steps AS step
          JOIN courses AS course ON course.id = step.course_id
          WHERE step.id = $1::bigint
            AND (
              (course.status = 'draft' AND course.visibility = 'private')
              OR (course.status = 'published' AND course.visibility = 'public')
            )
          FOR SHARE OF step, course
        `;
  } else {
    sql = `
      SELECT context.retrieval_version::text AS "sourceVersion",
             context.user_id AS "ownerId",
             'private'::text AS visibility
      FROM study_contexts AS context
      JOIN learning_items AS item ON item.id = context.learning_item_id
        AND item.user_id = context.user_id
      JOIN caption_artifacts AS artifact ON artifact.id = COALESCE(
        context.current_translation_caption_artifact_id,
        context.current_source_caption_artifact_id
      ) AND artifact.video_source_id = item.video_source_id
      JOIN caption_generation_states AS state ON state.artifact_id = artifact.id
        AND state.status IN ('partial', 'ready')
      WHERE context.id = $1::bigint
      FOR SHARE OF context, item, artifact, state
    `;
  }
  const result = await client.query<CurrentSourceRow>(sql, [sourceId]);
  return result.rows[0] ?? null;
}

async function deleteSourceModelChunks(
  client: PoolClient,
  input: Pick<ReplaceRetrievalChunks, 'sourceKind' | 'sourceId' | 'model'>,
): Promise<void> {
  await client.query(
    `
      DELETE FROM retrieval_embeddings
      WHERE source_kind = $1
        AND source_id = $2::bigint
        AND model = $3
    `,
    [input.sourceKind, input.sourceId, input.model],
  );
}

async function deleteAllSourceChunks(
  client: PoolClient,
  source: RetrievalSourceReference & { sourceId: string },
): Promise<void> {
  await client.query(
    `
      DELETE FROM retrieval_embeddings
      WHERE source_kind = $1
        AND source_id = $2::bigint
    `,
    [source.sourceKind, source.sourceId],
  );
}

function normalizeChunkReplacement(
  input: ReplaceRetrievalChunks,
): ReplaceRetrievalChunks & { sourceId: string; sourceVersion: string } {
  const sourceKind = canonicalSourceKind(input.sourceKind);
  const sourceId = canonicalPositiveId(input.sourceId);
  const sourceVersion = canonicalPositiveId(input.sourceVersion);
  if (!Number.isSafeInteger(input.ownerId) || input.ownerId <= 0) {
    throw new RangeError('Retrieval owner ID must be a positive integer');
  }
  if (!input.model.trim()) {
    throw new RangeError('Retrieval model must not be blank');
  }
  if (input.chunks.length === 0 || input.chunks.length > 128) {
    throw new RangeError('Retrieval chunk count must be between 1 and 128');
  }
  const chunks = input.chunks.map((chunk, index) => {
    const content = chunk.content.trim();
    if (chunk.chunkIndex !== index) {
      throw new RangeError('Retrieval chunk indexes must be contiguous');
    }
    if (!content || content.length > 3000) {
      throw new RangeError(
        'Retrieval chunk content must contain between 1 and 3000 characters',
      );
    }
    if (
      (chunk.startSeconds === null) !== (chunk.endSeconds === null) ||
      (chunk.startSeconds !== null &&
        (!Number.isInteger(chunk.startSeconds) ||
          !Number.isInteger(chunk.endSeconds) ||
          chunk.startSeconds < 0 ||
          (chunk.endSeconds ?? 0) <= chunk.startSeconds))
    ) {
      throw new RangeError('Retrieval chunk timestamp range is invalid');
    }
    embeddingLiteral(chunk.embedding);
    if (sourceKind === 'learning_context') {
      normalizeLearningEvidenceChunk(chunk);
    } else if (
      chunk.evidenceKind !== undefined ||
      chunk.resourceId !== undefined ||
      chunk.readiness !== undefined ||
      chunk.artifactGeneration !== undefined
    ) {
      throw new RangeError(
        'Legacy retrieval chunks cannot carry learning evidence',
      );
    }
    return { ...chunk, content };
  });
  return { ...input, sourceKind, sourceId, sourceVersion, chunks };
}

function sameChunkContentSet(
  existing: ExistingChunkRow[],
  input: ReplaceRetrievalChunks,
): boolean {
  if (existing.length !== input.chunks.length) {
    return false;
  }
  return existing.every((row, index) => {
    const chunk = input.chunks[index];
    if (!chunk) {
      return false;
    }
    const hash = createHash('sha256').update(chunk.content, 'utf8').digest();
    return (
      row.chunkIndex === chunk.chunkIndex &&
      row.startSeconds === chunk.startSeconds &&
      row.endSeconds === chunk.endSeconds &&
      row.contentHash.equals(hash)
    );
  });
}

function canonicalSourceKind(value: unknown): RetrievalSourceKind {
  if (
    value !== 'post' &&
    value !== 'course_step' &&
    value !== 'learning_context'
  ) {
    throw new RangeError('Retrieval source kind is invalid');
  }
  return value;
}

function normalizeLearningEvidenceChunk(
  chunk: ReplaceRetrievalChunks['chunks'][number],
): void {
  if (
    !chunk.resourceId?.trim() ||
    !chunk.evidenceKind ||
    !chunk.readiness ||
    !Number.isSafeInteger(chunk.artifactGeneration) ||
    (chunk.artifactGeneration ?? 0) <= 0
  ) {
    throw new RangeError('Learning evidence identity is incomplete');
  }
  if (chunk.evidenceKind === 'caption_segment') {
    canonicalPositiveId(chunk.evidenceArtifactId ?? '');
    canonicalPositiveId(chunk.evidenceSegmentId ?? '');
    if (chunk.evidenceNoteId || chunk.evidenceQuizAttemptId) {
      throw new RangeError('Caption evidence identity is invalid');
    }
    return;
  }
  if (chunk.evidenceKind === 'learning_note') {
    canonicalPositiveId(chunk.evidenceNoteId ?? '');
    if (
      chunk.evidenceArtifactId ||
      chunk.evidenceSegmentId ||
      chunk.evidenceQuizAttemptId
    ) {
      throw new RangeError('Note evidence identity is invalid');
    }
    return;
  }
  if (
    !chunk.evidenceQuizAttemptId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      chunk.evidenceQuizAttemptId,
    ) ||
    chunk.evidenceArtifactId ||
    chunk.evidenceSegmentId ||
    chunk.evidenceNoteId
  ) {
    throw new RangeError('Quiz evidence identity is invalid');
  }
}

function positiveOwnerId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Retrieval owner ID must be a positive integer');
  }
  return value;
}

function normalizeWatchedRanges(
  ranges: CaptureLearningRetrievalContext['watchedRanges'],
): Array<{ start: number; end: number }> {
  if (ranges.length < 1 || ranges.length > 128) {
    throw new RangeError(
      'Watched ranges must contain between 1 and 128 ranges',
    );
  }
  return ranges.map((range) => {
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.start < 0 ||
      range.end <= range.start
    ) {
      throw new RangeError('Watched range is invalid');
    }
    return { start: range.start, end: range.end };
  });
}

function learningContextSnapshot(
  row: LearningContextSnapshotRow,
): LearningRetrievalContextSnapshot {
  return {
    agentRunId: row.agentRunId,
    ownerId: Number(row.ownerId),
    studyContextId: String(row.studyContextId),
    learningItemId: String(row.learningItemId),
    videoSourceId: String(row.videoSourceId),
    courseId: row.courseId === null ? null : Number(row.courseId),
    profileGoal: row.profileGoal,
    watchedRanges: normalizeWatchedRanges(
      Array.isArray(row.watchedRanges)
        ? (row.watchedRanges as Array<{ start: number; end: number }>)
        : [],
    ),
    captionArtifactId: String(row.captionArtifactId),
    captionGeneration: Number(row.captionGeneration),
    contextRetrievalVersion: String(row.contextRetrievalVersion),
  };
}

function learningEvidenceItems(value: unknown): LearningEvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const kind = row.kind;
    const resourceId = typeof row.resourceId === 'string' ? row.resourceId : '';
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    const startSeconds = Number(row.startSeconds);
    const endSeconds = Number(row.endSeconds);
    const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl : '';
    const readiness = row.readiness;
    const artifactGeneration = Number(row.artifactGeneration);
    if (
      !['caption_segment', 'learning_note', 'quiz_outcome'].includes(
        String(kind),
      ) ||
      !resourceId ||
      !content ||
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      !sourceUrl ||
      !['partial', 'ready'].includes(String(readiness)) ||
      !Number.isSafeInteger(artifactGeneration) ||
      artifactGeneration <= 0
    ) {
      return [];
    }
    return [
      {
        kind: kind as LearningEvidenceItem['kind'],
        resourceId,
        content,
        startSeconds,
        endSeconds,
        sourceUrl,
        readiness: readiness as LearningEvidenceItem['readiness'],
        artifactId: optionalString(row.artifactId),
        segmentId: optionalString(row.segmentId),
        noteId: optionalString(row.noteId),
        quizAttemptId: optionalString(row.quizAttemptId),
        artifactGeneration,
      },
    ];
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function transcriptSegments(value: unknown): RetrievalTranscriptSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const row = item as Record<string, unknown>;
    const start = Number(row.start);
    const end = Number(row.end);
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      !text
    ) {
      return [];
    }
    return [{ start, end, text }];
  });
}
