import type { Pool } from 'pg';
import type {
  EnsureLearningContextCommand,
  LearningItemRepository,
} from './learning-item.repository';
import type {
  LearningCaptionPhase,
  LearningCaptionSegment,
  LearningCaptionSnapshot,
  LearningContext,
  LearningContextProvenance,
  VideoProvider,
} from './learning-item.types';

type CaptionSnapshotRow = {
  contextId: string;
  sourceArtifactId: string | null;
  sourceKind: 'youtube_caption' | 'transcription' | null;
  sourceGeneration: number | null;
  sourceLanguage: string | null;
  sourceStatus: 'pending' | 'partial' | 'ready' | 'failed' | null;
  translationArtifactId: string | null;
  translationGeneration: number | null;
  translationStatus: 'pending' | 'partial' | 'ready' | 'failed' | null;
  indexArtifactId: string | null;
  indexGeneration: number | null;
  indexStatus: 'pending' | 'partial' | 'ready' | 'failed' | null;
  retrievalReady: boolean;
  sourceSegments: LearningCaptionSegment[];
  koreanSegments: LearningCaptionSegment[];
  errorCode: string | null;
};

type LearningContextRow = {
  videoSourceId: string;
  provider: VideoProvider;
  canonicalVideoId: string;
  canonicalUrl: string;
  learningItemId: string;
  userId: number;
  sourcePostId: number | null;
  studyContextId: string;
  contextKind: 'standalone' | 'course_occurrence';
  courseStepId: string | null;
  courseStepProvenanceId: string | null;
  learningItemProvenance: LearningContextProvenance;
  studyContextProvenance: LearningContextProvenance;
};

export class PostgresLearningItemRepository implements LearningItemRepository {
  constructor(private readonly pool: Pool) {}

  async ensureContext(
    command: EnsureLearningContextCommand,
  ): Promise<LearningContext> {
    validate(command);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          [
            'learning-context',
            command.userId,
            command.provider,
            command.canonicalVideoId,
            command.courseStepId ?? 'standalone',
          ].join(':'),
        ],
      );
      const result = await client.query<LearningContextRow>(
        `
          WITH inserted_source AS (
            INSERT INTO video_sources (
              provider, canonical_video_id, canonical_url
            ) VALUES ($1, $2, $3)
            ON CONFLICT (provider, canonical_video_id) DO NOTHING
            RETURNING id, provider, canonical_video_id, canonical_url
          ), selected_source AS (
            SELECT * FROM inserted_source
            UNION ALL
            SELECT id, provider, canonical_video_id, canonical_url
            FROM video_sources
            WHERE provider = $1 AND canonical_video_id = $2
              AND NOT EXISTS (SELECT 1 FROM inserted_source)
          ), inserted_item AS (
            INSERT INTO learning_items (
              user_id, video_source_id, source_post_id, provenance
            )
            SELECT $4, id, $5, $7::jsonb FROM selected_source
            ON CONFLICT (user_id, video_source_id) DO NOTHING
            RETURNING id, user_id, video_source_id, source_post_id, provenance
          ), selected_item AS (
            SELECT * FROM inserted_item
            UNION ALL
            SELECT item.id, item.user_id, item.video_source_id,
                   item.source_post_id, item.provenance
            FROM learning_items AS item
            JOIN selected_source AS source ON source.id = item.video_source_id
            WHERE item.user_id = $4
              AND NOT EXISTS (SELECT 1 FROM inserted_item)
          ), inserted_course_context AS (
            INSERT INTO study_contexts (
              user_id, learning_item_id, kind, course_step_id,
              course_step_provenance_id, provenance
            )
            SELECT $4, id, 'course_occurrence', $6::bigint,
                   $6::bigint, $7::jsonb
            FROM selected_item
            WHERE $6::bigint IS NOT NULL
            ON CONFLICT (user_id, course_step_id)
              WHERE course_step_id IS NOT NULL DO NOTHING
            RETURNING id, user_id, learning_item_id, kind,
                      course_step_id, course_step_provenance_id, provenance
          ), inserted_standalone_context AS (
            INSERT INTO study_contexts (
              user_id, learning_item_id, kind, course_step_id, provenance
            )
            SELECT $4, id, 'standalone', NULL, $7::jsonb
            FROM selected_item
            WHERE $6::bigint IS NULL
            ON CONFLICT (learning_item_id)
              WHERE kind = 'standalone' DO NOTHING
            RETURNING id, user_id, learning_item_id, kind,
                      course_step_id, course_step_provenance_id, provenance
          ), selected_context AS (
            SELECT * FROM inserted_course_context
            UNION ALL
            SELECT * FROM inserted_standalone_context
            UNION ALL
            SELECT context.id, context.user_id, context.learning_item_id,
                   context.kind, context.course_step_id,
                   context.course_step_provenance_id, context.provenance
            FROM study_contexts AS context
            JOIN selected_item AS item ON item.id = context.learning_item_id
            WHERE context.user_id = $4
              AND (
                ($6::bigint IS NOT NULL AND context.course_step_id = $6::bigint)
                OR ($6::bigint IS NULL AND context.kind = 'standalone')
              )
              AND NOT EXISTS (SELECT 1 FROM inserted_course_context)
              AND NOT EXISTS (SELECT 1 FROM inserted_standalone_context)
          )
          SELECT source.id::text AS "videoSourceId",
                 source.provider,
                 source.canonical_video_id AS "canonicalVideoId",
                 source.canonical_url AS "canonicalUrl",
                 item.id::text AS "learningItemId",
                 item.user_id AS "userId",
                 item.source_post_id AS "sourcePostId",
                 item.provenance AS "learningItemProvenance",
                 context.id::text AS "studyContextId",
                 context.kind AS "contextKind",
                 context.course_step_id::text AS "courseStepId",
                 context.course_step_provenance_id::text
                   AS "courseStepProvenanceId",
                 context.provenance AS "studyContextProvenance"
          FROM selected_source AS source
          JOIN selected_item AS item ON item.video_source_id = source.id
          JOIN selected_context AS context ON context.learning_item_id = item.id
        `,
        [
          command.provider,
          command.canonicalVideoId,
          command.canonicalUrl,
          command.userId,
          command.sourcePostId,
          command.courseStepId,
          JSON.stringify(command.provenance),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Learning context could not be persisted');
      await client.query('COMMIT');
      return map(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findOwnerContext(
    userId: number,
    contextId: string,
  ): Promise<LearningContext | null> {
    const result = await this.pool.query<LearningContextRow>(
      `
        SELECT source.id::text AS "videoSourceId", source.provider,
               source.canonical_video_id AS "canonicalVideoId",
               source.canonical_url AS "canonicalUrl",
               item.id::text AS "learningItemId", item.user_id AS "userId",
               item.source_post_id AS "sourcePostId",
               item.provenance AS "learningItemProvenance",
               context.id::text AS "studyContextId",
               context.kind AS "contextKind",
               context.course_step_id::text AS "courseStepId",
               context.course_step_provenance_id::text
                 AS "courseStepProvenanceId",
               context.provenance AS "studyContextProvenance"
        FROM study_contexts AS context
        JOIN learning_items AS item ON item.id = context.learning_item_id
        JOIN video_sources AS source ON source.id = item.video_source_id
        WHERE context.id = $1::bigint AND context.user_id = $2
      `,
      [contextId, userId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async findOwnerCaptionSnapshot(
    userId: number,
    contextId: string,
  ): Promise<LearningCaptionSnapshot | null> {
    validateOwnerLookup(userId, contextId);
    const result = await this.pool.query<CaptionSnapshotRow>(
      `
        WITH owned AS (
          SELECT context.id, context.current_source_caption_artifact_id,
                 context.current_translation_caption_artifact_id,
                 context.current_caption_index_artifact_id,
                 context.retrieval_version,
                 item.video_source_id
          FROM study_contexts AS context
          JOIN learning_items AS item ON item.id = context.learning_item_id
          WHERE context.id = $1::bigint AND context.user_id = $2
        )
        SELECT owned.id::text AS "contextId",
               source.id::text AS "sourceArtifactId",
               source.kind AS "sourceKind",
               source.generation AS "sourceGeneration",
               source.source_language AS "sourceLanguage",
               source.status AS "sourceStatus",
               translation.id::text AS "translationArtifactId",
               translation.generation AS "translationGeneration",
               translation.status AS "translationStatus",
               caption_index.id::text AS "indexArtifactId",
               caption_index.generation AS "indexGeneration",
               caption_index.status AS "indexStatus",
               COALESCE(source.segments, '[]'::jsonb) AS "sourceSegments",
               COALESCE(translation.segments, '[]'::jsonb) AS "koreanSegments",
               EXISTS (
                 SELECT 1 FROM retrieval_embeddings AS retrieval
                 WHERE retrieval.source_kind = 'learning_context'
                   AND retrieval.source_id = owned.id
                   AND retrieval.owner_id = $2
                   AND retrieval.source_version = owned.retrieval_version
                   AND retrieval.artifact_generation = COALESCE(
                     translation.generation, source.generation
                   )
                   AND retrieval.readiness IN ('partial', 'ready')
               ) AS "retrievalReady",
               failure.safe_error_code AS "errorCode"
        FROM owned
        LEFT JOIN LATERAL (
          SELECT artifact.id, artifact.kind, artifact.generation,
                 artifact.source_language, state.status,
                 (
                   SELECT jsonb_agg(
                     jsonb_build_object(
                       'start', segment.start_seconds::float8,
                       'end', segment.end_seconds::float8,
                       'text', segment.text
                     ) ORDER BY segment.ordinal
                   )
                   FROM caption_artifact_segments AS segment
                   WHERE segment.artifact_id = artifact.id
                 ) AS segments
          FROM caption_artifacts AS artifact
          JOIN caption_generation_states AS state
            ON state.artifact_id = artifact.id
          WHERE artifact.video_source_id = owned.video_source_id
            AND artifact.kind IN ('youtube_caption', 'transcription')
            AND (
              artifact.id = owned.current_source_caption_artifact_id
              OR EXISTS (
                SELECT 1
                FROM provider_subscription_reservations AS subscription
                JOIN provider_work_reservations AS work
                  ON work.id = subscription.work_reservation_id
                WHERE subscription.study_context_id = owned.id
                  AND subscription.state IN ('reserved', 'committed')
                  AND work.state IN ('reserved', 'committed')
                  AND work.work_id = artifact.work_event_id
              )
            )
          ORDER BY
            (artifact.id = owned.current_source_caption_artifact_id) DESC,
            artifact.generation DESC, artifact.id DESC
          LIMIT 1
        ) AS source ON true
        LEFT JOIN LATERAL (
          SELECT artifact.id, artifact.generation, state.status,
                 (
                   SELECT jsonb_agg(
                     jsonb_build_object(
                       'start', segment.start_seconds::float8,
                       'end', segment.end_seconds::float8,
                       'text', segment.text
                     ) ORDER BY segment.ordinal
                   )
                   FROM caption_artifact_segments AS segment
                   WHERE segment.artifact_id = artifact.id
                 ) AS segments
          FROM caption_artifacts AS artifact
          JOIN caption_generation_states AS state
            ON state.artifact_id = artifact.id
          WHERE source.id IS NOT NULL
            AND artifact.video_source_id = owned.video_source_id
            AND artifact.kind = 'translation'
            AND artifact.target_language = 'ko'
            AND artifact.parent_artifact_id = source.id
            AND (
              artifact.id = owned.current_translation_caption_artifact_id
              OR EXISTS (
                SELECT 1
                FROM provider_subscription_reservations AS subscription
                JOIN provider_work_reservations AS work
                  ON work.id = subscription.work_reservation_id
                WHERE subscription.study_context_id = owned.id
                  AND subscription.state IN ('reserved', 'committed')
                  AND work.state IN ('reserved', 'committed')
                  AND work.work_id = artifact.work_event_id
              )
            )
          ORDER BY
            (artifact.id = owned.current_translation_caption_artifact_id) DESC,
            artifact.generation DESC, artifact.id DESC
          LIMIT 1
        ) AS translation ON true
        LEFT JOIN LATERAL (
          SELECT artifact.id, artifact.generation, state.status
          FROM caption_artifacts AS artifact
          JOIN caption_generation_states AS state
            ON state.artifact_id = artifact.id
          WHERE translation.id IS NOT NULL
            AND artifact.id = owned.current_caption_index_artifact_id
            AND artifact.video_source_id = owned.video_source_id
            AND artifact.kind = 'index'
            AND artifact.parent_artifact_id = translation.id
          LIMIT 1
        ) AS caption_index ON true
        LEFT JOIN LATERAL (
          SELECT latest_failure.safe_error_code
          FROM provider_subscription_reservations AS subscription
          JOIN provider_work_reservations AS work
            ON work.id = subscription.work_reservation_id
          LEFT JOIN LATERAL (
            SELECT work_failure.safe_error_code
            FROM caption_work_failures AS work_failure
            WHERE work_failure.work_event_id = work.work_id
            ORDER BY work_failure.created_at DESC, work_failure.handler_version DESC
            LIMIT 1
          ) AS latest_failure ON true
          WHERE subscription.study_context_id = owned.id
          ORDER BY work.created_at DESC, work.id DESC
          LIMIT 1
        ) AS failure ON true
      `,
      [contextId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      contextId: row.contextId,
      generation: Math.max(
        row.sourceGeneration ?? 0,
        row.translationGeneration ?? 0,
        row.indexGeneration ?? 0,
      ),
      phase: captionPhase(row),
      sourceLanguage: row.sourceLanguage ?? '',
      sourceSegments: row.sourceSegments,
      koreanSegments:
        row.sourceLanguage === 'ko' && row.koreanSegments.length === 0
          ? row.sourceSegments
          : row.koreanSegments,
      stale: Boolean(row.errorCode && row.sourceArtifactId),
      ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    };
  }
}

function captionPhase(row: CaptionSnapshotRow): LearningCaptionPhase {
  if (!row.sourceArtifactId) {
    return row.errorCode ? 'failed' : 'source_pending';
  }
  if (row.sourceStatus === 'failed') return 'failed';
  if (row.sourceStatus === 'pending') {
    return row.sourceKind === 'transcription'
      ? 'transcription_pending'
      : 'source_pending';
  }
  if (row.sourceStatus === 'partial') return 'partial';
  if (row.sourceLanguage === 'ko') {
    return row.retrievalReady || row.indexStatus === 'ready'
      ? 'complete'
      : 'index_pending';
  }
  if (!row.translationArtifactId) {
    return row.errorCode ? 'failed' : 'translation_pending';
  }
  if (row.translationStatus === 'failed') return 'failed';
  if (row.translationStatus === 'partial') return 'partial';
  if (row.translationStatus !== 'ready') return 'translation_pending';
  return row.retrievalReady || row.indexStatus === 'ready'
    ? 'complete'
    : 'index_pending';
}

function validateOwnerLookup(userId: number, contextId: string): void {
  if (!Number.isInteger(userId) || userId < 1) {
    throw new RangeError('userId must be a positive integer');
  }
  if (!/^[1-9]\d*$/u.test(contextId)) {
    throw new RangeError('contextId must be a positive integer string');
  }
}

function validate(command: EnsureLearningContextCommand): void {
  if (!Number.isInteger(command.userId) || command.userId < 1) {
    throw new RangeError('userId must be a positive integer');
  }
  if (!command.canonicalVideoId.trim() || !command.canonicalUrl.trim()) {
    throw new RangeError('canonical video identity is required');
  }
  if (command.courseStepId !== null && !/^\d+$/.test(command.courseStepId)) {
    throw new RangeError('courseStepId must be a positive integer string');
  }
}

function map(row: LearningContextRow): LearningContext {
  return {
    videoSource: {
      id: row.videoSourceId,
      provider: row.provider,
      canonicalVideoId: row.canonicalVideoId,
      canonicalUrl: row.canonicalUrl,
    },
    learningItem: {
      id: row.learningItemId,
      userId: row.userId,
      videoSourceId: row.videoSourceId,
      sourcePostId: row.sourcePostId,
      provenance: row.learningItemProvenance,
    },
    studyContext: {
      id: row.studyContextId,
      userId: row.userId,
      learningItemId: row.learningItemId,
      kind: row.contextKind,
      courseStepId: row.courseStepId,
      courseStepProvenanceId: row.courseStepProvenanceId,
      provenance: row.studyContextProvenance,
    },
  };
}
