import type { Pool } from 'pg';
import type {
  EnsureLearningContextCommand,
  LearningItemRepository,
} from './learning-item.repository';
import type {
  LearningContext,
  LearningContextProvenance,
  VideoProvider,
} from './learning-item.types';

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
