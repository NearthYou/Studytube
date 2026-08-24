import type { Pool, PoolClient } from 'pg';
import type {
  AppendLiveCaptionChunkCommand,
  LiveCaptionChunk,
  LiveCaptionChunkKey,
  LiveCaptionRepository,
  LiveCaptionSessionKey,
} from './live-caption.service';
import { DEFAULT_ESTIMATED_MICROUNITS_PER_AUDIO_SECOND } from './learning/provider-budget.repository';
import { deterministicWorkUuid } from './work/deterministic-work-id';

const HANDLER_VERSION = 'browser-live-caption-v1';

type OwnedContext = {
  videoSourceId: string;
};

type Artifact = {
  id: string;
  generation: number;
};

export class PostgresLiveCaptionRepository implements LiveCaptionRepository {
  constructor(private readonly pool: Pool) {}

  async hasActiveApproval(model: string): Promise<boolean> {
    const result = await this.pool.query<{ approved: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM stt_provider_approvals AS approval
         WHERE approval.model_snapshot = $1 AND approval.revoked_at IS NULL
           AND approval.approved_at <= statement_timestamp()
           AND approval.expires_at > statement_timestamp()
           AND COALESCE((
             SELECT ceil(sum(segment.end_seconds - segment.start_seconds) * $2)::bigint
             FROM caption_artifacts AS artifact
             JOIN caption_artifact_segments AS segment
               ON segment.artifact_id = artifact.id
             WHERE artifact.provider = 'browser-audio-transcription'
               AND artifact.created_at >= approval.approved_at
           ), 0) < approval.max_spend_microunits
       ) AS approved`,
      [model, DEFAULT_ESTIMATED_MICROUNITS_PER_AUDIO_SECOND],
    );
    return result.rows[0]?.approved === true;
  }

  async findChunk(
    input: LiveCaptionChunkKey,
  ): Promise<LiveCaptionChunk | null> {
    const result = await this.pool.query<LiveCaptionChunk>(
      `SELECT source.ordinal, source.start_seconds::float AS start,
              source.end_seconds::float AS end,
              source_artifact.source_language AS "sourceLanguage",
              source.text AS source,
              COALESCE(translation.text, '') AS korean
       FROM study_contexts AS context
       JOIN learning_items AS item ON item.id = context.learning_item_id
       JOIN caption_artifacts AS source_artifact
         ON source_artifact.video_source_id = item.video_source_id
        AND source_artifact.work_event_id = $3::uuid
        AND source_artifact.handler_version = '${HANDLER_VERSION}'
        AND source_artifact.kind = 'transcription'
       JOIN caption_artifact_segments AS source
         ON source.artifact_id = source_artifact.id AND source.ordinal = $4
       LEFT JOIN caption_artifacts AS translation_artifact
         ON translation_artifact.parent_artifact_id = source_artifact.id
        AND translation_artifact.work_event_id = source_artifact.work_event_id
        AND translation_artifact.handler_version = source_artifact.handler_version
        AND translation_artifact.kind = 'translation'
       LEFT JOIN caption_artifact_segments AS translation
         ON translation.artifact_id = translation_artifact.id
        AND translation.ordinal = source.ordinal
       WHERE context.user_id = $1 AND context.id = $2::bigint`,
      [input.userId, input.contextId, input.sessionId, input.ordinal],
    );
    return result.rows[0] ?? null;
  }

  async appendChunk(input: AppendLiveCaptionChunkCommand): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const context = await this.ownedContext(client, input);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        context.videoSourceId,
      ]);
      const source = await this.artifact(client, {
        videoSourceId: context.videoSourceId,
        sessionId: input.sessionId,
        kind: 'transcription',
        sourceLanguage: input.sourceLanguage.trim() || 'und',
      });
      const translation = input.korean.trim()
        ? await this.artifact(client, {
            videoSourceId: context.videoSourceId,
            sessionId: input.sessionId,
            kind: 'translation',
            sourceLanguage: input.sourceLanguage.trim() || 'und',
            parentArtifactId: source.id,
            targetLanguage: 'ko',
          })
        : null;
      await this.storeSegment(client, source.id, input.ordinal, input);
      if (translation) {
        await this.storeSegment(client, translation.id, input.ordinal, {
          ...input,
          source: input.korean,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async finalize(input: LiveCaptionSessionKey): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        videoSourceId: string;
        sourceArtifactId: string;
        sourceGeneration: number;
        translationArtifactId: string | null;
      }>(
        `SELECT item.video_source_id::text AS "videoSourceId",
                source.id::text AS "sourceArtifactId",
                source.generation AS "sourceGeneration",
                translation.id::text AS "translationArtifactId"
         FROM study_contexts AS context
         JOIN learning_items AS item ON item.id = context.learning_item_id
         JOIN caption_artifacts AS source
           ON source.video_source_id = item.video_source_id
          AND source.work_event_id = $3::uuid
          AND source.handler_version = '${HANDLER_VERSION}'
          AND source.kind = 'transcription'
         LEFT JOIN caption_artifacts AS translation
           ON translation.parent_artifact_id = source.id
          AND translation.work_event_id = source.work_event_id
          AND translation.handler_version = source.handler_version
          AND translation.kind = 'translation'
         WHERE context.user_id = $1 AND context.id = $2::bigint
           AND EXISTS (
             SELECT 1 FROM caption_artifact_segments
             WHERE artifact_id = source.id
           )
         FOR UPDATE OF context, source`,
        [input.userId, input.contextId, input.sessionId],
      );
      const artifact = result.rows[0];
      if (!artifact) {
        await client.query('ROLLBACK');
        return false;
      }
      const artifactIds = [
        artifact.sourceArtifactId,
        artifact.translationArtifactId,
      ].filter((id): id is string => id !== null);
      await client.query(
        `UPDATE caption_generation_states
         SET status = 'ready', safe_error_code = NULL,
             updated_at = statement_timestamp()
         WHERE artifact_id = ANY($1::bigint[])`,
        [artifactIds],
      );
      await client.query(
        `UPDATE video_sources AS source
         SET current_source_caption_artifact_id = $1::bigint,
             updated_at = statement_timestamp()
         WHERE source.id = $2::bigint
           AND (
             source.current_source_caption_artifact_id IS NULL OR
             (SELECT generation FROM caption_artifacts
              WHERE id = source.current_source_caption_artifact_id) <= $3
           )`,
        [
          artifact.sourceArtifactId,
          artifact.videoSourceId,
          artifact.sourceGeneration,
        ],
      );
      const contextUpdate = await client.query<{ retrievalVersion: string }>(
        `UPDATE study_contexts AS context
         SET current_source_caption_artifact_id = $3::bigint,
             current_translation_caption_artifact_id = $4::bigint,
             current_caption_index_artifact_id = NULL,
             updated_at = statement_timestamp()
         WHERE context.user_id = $1 AND context.id = $2::bigint
           AND (
             context.current_source_caption_artifact_id IS NULL OR
             (SELECT generation FROM caption_artifacts
              WHERE id = context.current_source_caption_artifact_id) <= $5
           )
         RETURNING context.retrieval_version::text AS "retrievalVersion"`,
        [
          input.userId,
          input.contextId,
          artifact.sourceArtifactId,
          artifact.translationArtifactId,
          artifact.sourceGeneration,
        ],
      );
      const retrievalVersion = contextUpdate.rows[0]?.retrievalVersion;
      if (retrievalVersion) {
        const captionArtifactId =
          artifact.translationArtifactId ?? artifact.sourceArtifactId;
        const eventId = deterministicWorkUuid(
          input.sessionId,
          `retrieval_embedding.learning_context.${input.contextId}.${retrievalVersion}`,
        );
        await client.query(
          `INSERT INTO work_outbox_events (
             id, event_type, aggregate_type, aggregate_id, aggregate_version,
             payload_schema_version, payload
           ) VALUES ($1, 'retrieval_embedding.requested', 'study_context',
                     $2, $3::bigint, 1, $4::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [
            eventId,
            input.contextId,
            retrievalVersion,
            JSON.stringify({
              sourceKind: 'learning_context',
              sourceId: input.contextId,
              sourceVersion: retrievalVersion,
              causeEventId: input.sessionId,
              captionArtifactId,
            }),
          ],
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ownedContext(
    client: PoolClient,
    input: { userId: number; contextId: string },
  ): Promise<OwnedContext> {
    const result = await client.query<OwnedContext>(
      `SELECT item.video_source_id::text AS "videoSourceId"
       FROM study_contexts AS context
       JOIN learning_items AS item ON item.id = context.learning_item_id
       WHERE context.user_id = $1 AND context.id = $2::bigint
       FOR SHARE OF context, item`,
      [input.userId, input.contextId],
    );
    const context = result.rows[0];
    if (!context) throw new Error('LEARNING_CONTEXT_NOT_FOUND');
    return context;
  }

  private async artifact(
    client: PoolClient,
    input: {
      videoSourceId: string;
      sessionId: string;
      kind: 'transcription' | 'translation';
      sourceLanguage: string;
      parentArtifactId?: string;
      targetLanguage?: 'ko';
    },
  ): Promise<Artifact> {
    const existing = await client.query<Artifact>(
      `SELECT id::text AS id, generation FROM caption_artifacts
       WHERE work_event_id = $1::uuid AND handler_version = $2 AND kind = $3`,
      [input.sessionId, HANDLER_VERSION, input.kind],
    );
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await client.query<Artifact>(
      `INSERT INTO caption_artifacts (
         video_source_id, kind, parent_artifact_id, generation,
         source_language, target_language, provider, work_event_id,
         handler_version
       )
       SELECT $1::bigint, $2, $3::bigint,
              COALESCE(max(generation), 0) + 1,
              $4, $5, $6, $7::uuid, $8
       FROM caption_artifacts WHERE video_source_id = $1::bigint
       RETURNING id::text AS id, generation`,
      [
        input.videoSourceId,
        input.kind,
        input.parentArtifactId ?? null,
        input.sourceLanguage,
        input.targetLanguage ?? null,
        input.kind === 'translation'
          ? 'openai-caption-translation'
          : 'browser-audio-transcription',
        input.sessionId,
        HANDLER_VERSION,
      ],
    );
    const artifact = inserted.rows[0];
    if (!artifact) throw new Error('CAPTION_GENERATION_NOT_CREATED');
    await client.query(
      `INSERT INTO caption_generation_states (artifact_id)
       VALUES ($1::bigint) ON CONFLICT (artifact_id) DO NOTHING`,
      [artifact.id],
    );
    return artifact;
  }

  private async storeSegment(
    client: PoolClient,
    artifactId: string,
    ordinal: number,
    input: {
      startSeconds: number;
      endSeconds: number;
      source: string;
    },
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO caption_artifact_segments (
         artifact_id, ordinal, start_seconds, end_seconds, text
       ) VALUES ($1::bigint, $2, $3, $4, $5)
       ON CONFLICT (artifact_id, ordinal) DO UPDATE SET text = EXCLUDED.text
       WHERE caption_artifact_segments.start_seconds = EXCLUDED.start_seconds
         AND caption_artifact_segments.end_seconds = EXCLUDED.end_seconds
       RETURNING id`,
      [
        artifactId,
        ordinal,
        input.startSeconds,
        input.endSeconds,
        input.source.trim(),
      ],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error('CAPTION_CHUNK_CONFLICT');
    await client.query(
      `UPDATE caption_generation_states
       SET status = 'partial', safe_error_code = NULL,
           last_ordinal = GREATEST(last_ordinal, $2),
           updated_at = statement_timestamp()
       WHERE artifact_id = $1::bigint AND status IN ('pending', 'partial')`,
      [artifactId, ordinal],
    );
  }
}
