import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  LearningOverviewGeneration,
  LearningOverviewRepository,
  LearningOverviewSnapshot,
  LearningOverviewSummary,
  LearningSegmentContext,
} from './learning-overview.repository';

type CurrentArtifactRow = {
  contextId: string;
  artifactId: string | null;
  generation: number | null;
  state: 'pending' | 'partial' | 'ready' | 'failed' | null;
  sourceKind: 'youtube_caption' | 'transcription' | null;
  startSeconds: number | null;
  endSeconds: number | null;
};

type SummaryRow = {
  contextId: string;
  status: 'pending' | 'ready' | 'failed';
  scope: 'full_video' | 'study_range';
  startSeconds: number;
  endSeconds: number;
  payload: LearningOverviewSummary | null;
  safeErrorCode: string | null;
};

export class PostgresLearningOverviewRepository implements LearningOverviewRepository {
  constructor(private readonly pool: Pool) {}

  async requestOwnerOverview(
    userId: number,
    contextId: string,
  ): Promise<LearningOverviewSnapshot | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`learning-overview:${contextId}`],
      );
      const current = await client.query<CurrentArtifactRow>(
        `
          SELECT context.id::text AS "contextId",
                 effective.id::text AS "artifactId",
                 effective.generation,
                 generation_state.status AS state,
                 source.kind AS "sourceKind",
                 bounds.start_seconds::float8 AS "startSeconds",
                 bounds.end_seconds::float8 AS "endSeconds"
          FROM study_contexts AS context
          JOIN learning_items AS item ON item.id = context.learning_item_id
          LEFT JOIN caption_artifacts AS source
            ON source.id = context.current_source_caption_artifact_id
          LEFT JOIN caption_artifacts AS translation
            ON translation.id = context.current_translation_caption_artifact_id
          LEFT JOIN caption_artifacts AS effective
            ON effective.id = COALESCE(translation.id, source.id)
          LEFT JOIN caption_generation_states AS generation_state
            ON generation_state.artifact_id = effective.id
          LEFT JOIN LATERAL (
            SELECT MIN(segment.start_seconds) AS start_seconds,
                   MAX(segment.end_seconds) AS end_seconds
            FROM caption_artifact_segments AS segment
            WHERE segment.artifact_id = effective.id
          ) AS bounds ON true
          WHERE context.id = $1::bigint AND context.user_id = $2
        `,
        [contextId, userId],
      );
      const artifact = current.rows[0];
      if (!artifact) {
        await client.query('ROLLBACK');
        return null;
      }
      const coverage = {
        scope:
          artifact.sourceKind === 'youtube_caption'
            ? ('full_video' as const)
            : ('study_range' as const),
        startSeconds: artifact.startSeconds ?? 0,
        endSeconds: artifact.endSeconds ?? 0,
      };
      if (
        !artifact.artifactId ||
        !artifact.generation ||
        artifact.state !== 'ready' ||
        coverage.endSeconds <= coverage.startSeconds
      ) {
        await client.query('COMMIT');
        return { contextId, status: 'pending', coverage };
      }

      const existing = await client.query<SummaryRow>(
        `
          SELECT summary.study_context_id::text AS "contextId",
                 summary.status, summary.coverage_scope AS scope,
                 summary.coverage_start_seconds::float8 AS "startSeconds",
                 summary.coverage_end_seconds::float8 AS "endSeconds",
                 summary.payload, summary.safe_error_code AS "safeErrorCode"
          FROM learning_context_summaries AS summary
          WHERE summary.study_context_id = $1::bigint
            AND summary.caption_artifact_id = $2::bigint
            AND summary.caption_generation = $3
            AND summary.coverage_start_seconds = $4
            AND summary.coverage_end_seconds = $5
        `,
        [
          contextId,
          artifact.artifactId,
          artifact.generation,
          coverage.startSeconds,
          coverage.endSeconds,
        ],
      );
      let row = existing.rows[0];
      if (!row) {
        const eventId = randomUUID();
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO learning_context_summaries (
              study_context_id, caption_artifact_id, caption_generation,
              coverage_scope, coverage_start_seconds, coverage_end_seconds,
              status, event_id
            ) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, 'pending', $7::uuid)
            RETURNING id::text AS id
          `,
          [
            contextId,
            artifact.artifactId,
            artifact.generation,
            coverage.scope,
            coverage.startSeconds,
            coverage.endSeconds,
            eventId,
          ],
        );
        const summaryId = inserted.rows[0]?.id;
        if (!summaryId) throw new Error('Learning summary was not created');
        await client.query(
          `
            INSERT INTO work_outbox_events (
              id, event_type, aggregate_type, aggregate_id,
              aggregate_version, payload_schema_version, payload
            ) VALUES (
              $1::uuid, 'learning_summary.requested', 'learning_context_summary',
              $2::text, $3::int, 1, jsonb_build_object(
                'summaryId', $2::text,
                'studyContextId', $4::text,
                'captionArtifactId', $5::text,
                'captionGeneration', $3::int
              )
            )
          `,
          [
            eventId,
            summaryId,
            artifact.generation,
            contextId,
            artifact.artifactId,
          ],
        );
        row = {
          contextId,
          status: 'pending',
          scope: coverage.scope,
          startSeconds: coverage.startSeconds,
          endSeconds: coverage.endSeconds,
          payload: null,
          safeErrorCode: null,
        };
      }
      await client.query('COMMIT');
      return mapSummary(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async loadGeneration(
    summaryId: string,
  ): Promise<LearningOverviewGeneration | null> {
    const result = await this.pool.query<{
      summaryId: string;
      contextId: string;
      status: 'pending' | 'ready' | 'failed';
      videoId: string;
      captionArtifactId: string;
      captionGeneration: number;
      scope: 'full_video' | 'study_range';
      startSeconds: number;
      endSeconds: number;
      segments: Array<{ start: number; end: number; text: string }>;
    }>(
      `
        SELECT summary.id::text AS "summaryId",
               summary.study_context_id::text AS "contextId",
               summary.status,
               source.canonical_video_id AS "videoId",
               summary.caption_artifact_id::text AS "captionArtifactId",
               summary.caption_generation AS "captionGeneration",
               summary.coverage_scope AS scope,
               summary.coverage_start_seconds::float8 AS "startSeconds",
               summary.coverage_end_seconds::float8 AS "endSeconds",
               COALESCE(jsonb_agg(jsonb_build_object(
                 'start', segment.start_seconds::float8,
                 'end', segment.end_seconds::float8,
                 'text', segment.text
               ) ORDER BY segment.ordinal) FILTER (WHERE segment.id IS NOT NULL), '[]'::jsonb)
                 AS segments
        FROM learning_context_summaries AS summary
        JOIN study_contexts AS context ON context.id = summary.study_context_id
        JOIN learning_items AS item ON item.id = context.learning_item_id
        JOIN video_sources AS source ON source.id = item.video_source_id
        LEFT JOIN caption_artifact_segments AS segment
          ON segment.artifact_id = summary.caption_artifact_id
        WHERE summary.id = $1::bigint
        GROUP BY summary.id, source.canonical_video_id
      `,
      [summaryId],
    );
    const row = result.rows[0];
    return row
      ? {
          summaryId: row.summaryId,
          contextId: row.contextId,
          status: row.status,
          videoId: row.videoId,
          captionArtifactId: row.captionArtifactId,
          captionGeneration: row.captionGeneration,
          coverage: {
            scope: row.scope,
            startSeconds: row.startSeconds,
            endSeconds: row.endSeconds,
          },
          segments: row.segments,
        }
      : null;
  }

  async completeGeneration(
    summaryId: string,
    summary: LearningOverviewSummary,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE learning_context_summaries AS summary_row
        SET status = 'ready', payload = $2::jsonb, safe_error_code = NULL,
            updated_at = statement_timestamp()
        FROM study_contexts AS context
        WHERE summary_row.id = $1::bigint
          AND summary_row.status = 'pending'
          AND context.id = summary_row.study_context_id
          AND COALESCE(context.current_translation_caption_artifact_id,
                       context.current_source_caption_artifact_id)
                = summary_row.caption_artifact_id
      `,
      [summaryId, JSON.stringify(summary)],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async failGeneration(summaryId: string, errorCode: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE learning_context_summaries
        SET status = 'failed', payload = NULL, safe_error_code = $2,
            updated_at = statement_timestamp()
        WHERE id = $1::bigint AND status = 'pending'
      `,
      [summaryId, errorCode],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findOwnerSegment(
    userId: number,
    contextId: string,
    startSeconds: number,
    endSeconds: number,
  ): Promise<LearningSegmentContext | null> {
    const result = await this.pool.query<LearningSegmentContext>(
      `
        WITH owned AS (
          SELECT context.id, context.current_source_caption_artifact_id,
                 context.current_translation_caption_artifact_id
          FROM study_contexts AS context
          WHERE context.id = $1::bigint AND context.user_id = $2
        )
        SELECT owned.id::text AS "contextId",
               COALESCE(source_artifact.source_language, '') AS "sourceLanguage",
               COALESCE(source_text.body, '') AS source,
               CASE
                 WHEN source_artifact.source_language = 'ko'
                   THEN COALESCE(source_text.body, '')
                 ELSE COALESCE(korean_text.body, '')
               END AS korean,
               LEAST(COALESCE(source_text.start_seconds, $3), $3)::float8
                 AS "startSeconds",
               GREATEST(COALESCE(source_text.end_seconds, $4), $4)::float8
                 AS "endSeconds"
        FROM owned
        LEFT JOIN caption_artifacts AS source_artifact
          ON source_artifact.id = owned.current_source_caption_artifact_id
        LEFT JOIN LATERAL (
          SELECT string_agg(segment.text, ' ' ORDER BY segment.ordinal) AS body,
                 MIN(segment.start_seconds) AS start_seconds,
                 MAX(segment.end_seconds) AS end_seconds
          FROM caption_artifact_segments AS segment
          WHERE segment.artifact_id = owned.current_source_caption_artifact_id
            AND segment.start_seconds < $4
            AND segment.end_seconds > $3
        ) AS source_text ON true
        LEFT JOIN LATERAL (
          SELECT string_agg(segment.text, ' ' ORDER BY segment.ordinal) AS body
          FROM caption_artifact_segments AS segment
          WHERE segment.artifact_id = owned.current_translation_caption_artifact_id
            AND segment.start_seconds < $4
            AND segment.end_seconds > $3
        ) AS korean_text ON true
      `,
      [contextId, userId, startSeconds, endSeconds],
    );
    const row = result.rows[0];
    return row?.source.trim() ? row : null;
  }
}

function mapSummary(row: SummaryRow): LearningOverviewSnapshot {
  return {
    contextId: row.contextId,
    status: row.status,
    coverage: {
      scope: row.scope,
      startSeconds: Number(row.startSeconds),
      endSeconds: Number(row.endSeconds),
    },
    ...(row.status === 'ready' && row.payload ? { summary: row.payload } : {}),
    ...(row.status === 'failed' && row.safeErrorCode
      ? { errorCode: row.safeErrorCode }
      : {}),
  };
}
