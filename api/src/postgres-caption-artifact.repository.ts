import type { Pool } from 'pg';
import type {
  CaptionArtifactKind,
  CaptionArtifactRepository,
  CaptionGeneration,
  CaptionPipelineRequest,
  CaptionSafeErrorCode,
  CaptionSegmentBatch,
} from './video-asset.types';

type ArtifactRow = {
  id: string;
  generation: number;
  kind: CaptionArtifactKind | 'index';
  videoSourceId: string;
  parentArtifactId: string | null;
  status: 'partial' | 'ready';
};

export class PostgresCaptionArtifactRepository implements CaptionArtifactRepository {
  constructor(private readonly pool: Pool) {}

  async hasActiveSttApproval(model: string): Promise<boolean> {
    if (!model.trim()) throw new RangeError('model is invalid');
    const result = await this.pool.query<{ approved: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM stt_provider_approvals
         WHERE model_snapshot = $1
           AND revoked_at IS NULL
           AND approved_at <= statement_timestamp()
           AND expires_at > statement_timestamp()
       ) AS approved`,
      [model],
    );
    return result.rows[0]?.approved === true;
  }

  async createGeneration(input: {
    kind: CaptionArtifactKind;
    parentArtifactId?: string;
    sourceLanguage: string;
    targetLanguage?: string;
    request: CaptionPipelineRequest;
  }): Promise<CaptionGeneration> {
    validateRequest(input.request);
    validateKind(input.kind, input.parentArtifactId, input.targetLanguage);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lease = await client.query<{ active: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM work_job_claims AS claim
           JOIN provider_work_reservations AS work
             ON work.work_id = claim.event_id
            AND work.state IN ('reserved', 'committed')
           WHERE claim.event_id = $1::uuid AND claim.handler_version = $2
             AND claim.lease_token = $3::uuid
             AND claim.lease_expires_at > statement_timestamp()
             AND EXISTS (
               SELECT 1 FROM provider_subscription_reservations AS subscription
               WHERE subscription.work_reservation_id = work.id
                 AND subscription.state IN ('reserved', 'committed')
             )
         ) AS active`,
        [
          input.request.eventId,
          input.request.handlerVersion,
          input.request.leaseToken,
        ],
      );
      if (lease.rows[0]?.active !== true) {
        throw new CaptionArtifactLeaseLostError();
      }
      const source = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM video_sources
         WHERE provider = 'youtube' AND canonical_video_id = $1
         FOR SHARE`,
        [input.request.canonicalVideoId],
      );
      const videoSourceId = source.rows[0]?.id;
      if (!videoSourceId) throw new Error('VIDEO_SOURCE_NOT_FOUND');
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        videoSourceId,
      ]);
      const existing = await client.query<CaptionGeneration>(
        `SELECT id::text AS id, generation
         FROM caption_artifacts
         WHERE work_event_id = $1 AND handler_version = $2 AND kind = $3`,
        [input.request.eventId, input.request.handlerVersion, input.kind],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return existing.rows[0];
      }
      const inserted = await client.query<CaptionGeneration>(
        `INSERT INTO caption_artifacts (
           video_source_id, kind, parent_artifact_id, generation,
           source_language, target_language, provider, work_event_id,
           handler_version
         )
         SELECT $1, $2, $3::bigint,
                COALESCE(max(artifact.generation), 0) + 1,
                $4, $5, $6, $7, $8
         FROM caption_artifacts AS artifact
         WHERE artifact.video_source_id = $1
         RETURNING id::text AS id, generation`,
        [
          videoSourceId,
          input.kind,
          input.parentArtifactId ?? null,
          input.sourceLanguage.trim() || 'und',
          input.targetLanguage ?? null,
          providerFor(input.kind),
          input.request.eventId,
          input.request.handlerVersion,
        ],
      );
      const generation = inserted.rows[0];
      if (!generation) throw new Error('CAPTION_GENERATION_NOT_CREATED');
      await client.query(
        `INSERT INTO caption_generation_states (artifact_id)
         VALUES ($1)`,
        [generation.id],
      );
      await client.query('COMMIT');
      return generation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendSegments(input: CaptionSegmentBatch): Promise<boolean> {
    validateRequest(input.request);
    validateDecimalId(input.artifactId, 'artifactId');
    if (input.segments.length === 0) return true;
    const result = await this.pool.query<{ accepted: boolean }>(
      `WITH active AS (
         SELECT 1
         FROM work_job_claims AS claim
         JOIN provider_work_reservations AS work
           ON work.work_id = claim.event_id
          AND work.state IN ('reserved', 'committed')
         JOIN caption_artifacts AS artifact
           ON artifact.work_event_id = claim.event_id
          AND artifact.handler_version = claim.handler_version
         WHERE artifact.id = $1::bigint
           AND claim.event_id = $2::uuid
           AND claim.handler_version = $3
           AND claim.lease_token = $4::uuid
           AND claim.lease_expires_at > statement_timestamp()
           AND EXISTS (
             SELECT 1 FROM provider_subscription_reservations AS subscription
             WHERE subscription.work_reservation_id = work.id
               AND subscription.state IN ('reserved', 'committed')
           )
       ), incoming AS (
         SELECT ordinal, start_seconds, end_seconds, text
         FROM jsonb_to_recordset($5::jsonb) AS item(
           ordinal integer,
           start_seconds numeric,
           end_seconds numeric,
           text text
         )
       ), inserted AS (
         INSERT INTO caption_artifact_segments (
           artifact_id, ordinal, start_seconds, end_seconds, text
         )
         SELECT $1::bigint, incoming.ordinal, incoming.start_seconds,
                incoming.end_seconds, incoming.text
         FROM incoming CROSS JOIN active
         ON CONFLICT (artifact_id, ordinal) DO UPDATE
           SET text = caption_artifact_segments.text
         WHERE caption_artifact_segments.start_seconds = EXCLUDED.start_seconds
           AND caption_artifact_segments.end_seconds = EXCLUDED.end_seconds
           AND caption_artifact_segments.text = EXCLUDED.text
         RETURNING ordinal
       ), progressed AS (
         UPDATE caption_generation_states
         SET status = 'partial', safe_error_code = NULL,
             last_ordinal = GREATEST(
               last_ordinal,
               COALESCE((SELECT max(ordinal) FROM inserted), last_ordinal)
             ),
             updated_at = statement_timestamp()
         WHERE artifact_id = $1::bigint
           AND status IN ('pending', 'partial')
           AND (SELECT count(*) FROM inserted) =
               (SELECT count(*) FROM incoming)
           AND EXISTS (SELECT 1 FROM active)
         RETURNING artifact_id
       ), accepted_ready AS (
         SELECT state.artifact_id
         FROM caption_generation_states AS state
         WHERE state.artifact_id = $1::bigint
           AND state.status = 'ready'
           AND (SELECT count(*) FROM inserted) =
               (SELECT count(*) FROM incoming)
           AND EXISTS (SELECT 1 FROM active)
       )
       SELECT EXISTS (
         SELECT 1 FROM progressed UNION ALL SELECT 1 FROM accepted_ready
       ) AS accepted`,
      [
        input.artifactId,
        input.request.eventId,
        input.request.handlerVersion,
        input.request.leaseToken,
        JSON.stringify(
          input.segments.map((segment) => ({
            ordinal: segment.ordinal,
            start_seconds: segment.start,
            end_seconds: segment.end,
            text: segment.text,
          })),
        ),
      ],
    );
    return result.rows[0]?.accepted === true;
  }

  async publishGeneration(input: {
    artifactId: string;
    request: CaptionPipelineRequest;
  }): Promise<boolean> {
    validateRequest(input.request);
    validateDecimalId(input.artifactId, 'artifactId');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const artifactResult = await client.query<ArtifactRow>(
        `SELECT artifact.id::text AS id, artifact.generation, artifact.kind,
                artifact.video_source_id::text AS "videoSourceId",
                artifact.parent_artifact_id::text AS "parentArtifactId",
                state.status
         FROM caption_artifacts AS artifact
         JOIN caption_generation_states AS state ON state.artifact_id = artifact.id
         JOIN work_job_claims AS claim
           ON claim.event_id = artifact.work_event_id
          AND claim.handler_version = artifact.handler_version
         JOIN provider_work_reservations AS work
           ON work.work_id = claim.event_id
          AND work.state IN ('reserved', 'committed')
         WHERE artifact.id = $1::bigint
           AND claim.event_id = $2::uuid
           AND claim.handler_version = $3
           AND claim.lease_token = $4::uuid
           AND claim.lease_expires_at > statement_timestamp()
           AND state.status IN ('partial', 'ready')
           AND EXISTS (
             SELECT 1 FROM provider_subscription_reservations AS subscription
             WHERE subscription.work_reservation_id = work.id
               AND subscription.state IN ('reserved', 'committed')
           )
         FOR UPDATE OF artifact, state, work`,
        [
          input.artifactId,
          input.request.eventId,
          input.request.handlerVersion,
          input.request.leaseToken,
        ],
      );
      const artifact = artifactResult.rows[0];
      if (!artifact) {
        await client.query('ROLLBACK');
        return false;
      }
      if (artifact.status === 'ready') {
        const current = await this.isCurrentPointer(
          client,
          artifact,
          input.request,
        );
        await client.query(current ? 'COMMIT' : 'ROLLBACK');
        return current;
      }
      const pointerUpdated = await this.updateCurrentPointer(
        client,
        artifact,
        input.request,
      );
      if (!pointerUpdated) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `UPDATE caption_generation_states
         SET status = 'ready', safe_error_code = NULL,
             updated_at = statement_timestamp()
         WHERE artifact_id = $1::bigint`,
        [input.artifactId],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failGeneration(input: {
    request: CaptionPipelineRequest;
    errorCode: CaptionSafeErrorCode;
  }): Promise<void> {
    validateRequest(input.request);
    if (!SAFE_CODES.has(input.errorCode))
      throw new RangeError('errorCode is invalid');
    await this.pool.query(
      `WITH active_work AS (
         SELECT work.id
         FROM work_job_claims AS claim
         JOIN provider_work_reservations AS work
           ON work.work_id = claim.event_id AND work.state = 'reserved'
         WHERE claim.event_id = $1::uuid AND claim.handler_version = $2
           AND claim.lease_token = $3::uuid
           AND claim.lease_expires_at > statement_timestamp()
       ), recorded AS (
         INSERT INTO caption_work_failures (
           work_event_id, handler_version, safe_error_code
         )
         SELECT $1::uuid, $2, $4 FROM active_work
         ON CONFLICT (work_event_id, handler_version) DO NOTHING
         RETURNING work_event_id
       ), released_subscriptions AS (
         UPDATE provider_subscription_reservations AS subscription
         SET state = 'released', released_at = statement_timestamp()
         FROM active_work
         WHERE subscription.work_reservation_id = active_work.id
           AND subscription.state = 'reserved'
           AND EXISTS (SELECT 1 FROM recorded UNION ALL SELECT 1 FROM active_work)
         RETURNING subscription.id
       )
       UPDATE provider_work_reservations AS work
       SET state = 'released', released_at = statement_timestamp()
       FROM active_work
       WHERE work.id = active_work.id AND work.state = 'reserved'
         AND (SELECT count(*) FROM released_subscriptions) >= 0`,
      [
        input.request.eventId,
        input.request.handlerVersion,
        input.request.leaseToken,
        input.errorCode,
      ],
    );
  }

  async commitWork(input: {
    request: CaptionPipelineRequest;
    actualCostMicrounits: number;
  }): Promise<void> {
    validateRequest(input.request);
    if (
      !Number.isSafeInteger(input.actualCostMicrounits) ||
      input.actualCostMicrounits < 0
    ) {
      throw new RangeError('actualCostMicrounits is invalid');
    }
    await this.pool.query(
      `WITH committed_work AS (
         UPDATE provider_work_reservations AS work
         SET state = 'committed', actual_cost_microunits = $4,
             committed_at = statement_timestamp()
         WHERE work.work_id = $1::uuid AND work.state = 'reserved'
           AND EXISTS (
             SELECT 1 FROM work_job_claims AS claim
             WHERE claim.event_id = $1::uuid AND claim.handler_version = $2
               AND claim.lease_token = $3::uuid
               AND claim.lease_expires_at > statement_timestamp()
           )
         RETURNING work.id
       )
       UPDATE provider_subscription_reservations AS subscription
       SET state = 'committed', committed_at = statement_timestamp()
       FROM committed_work
       WHERE subscription.work_reservation_id = committed_work.id
         AND subscription.state = 'reserved'`,
      [
        input.request.eventId,
        input.request.handlerVersion,
        input.request.leaseToken,
        input.actualCostMicrounits,
      ],
    );
  }

  private async updateCurrentPointer(
    client: Pick<Pool, 'query'>,
    artifact: ArtifactRow,
    request: CaptionPipelineRequest,
  ): Promise<boolean> {
    const leaseParams = [
      artifact.id,
      artifact.videoSourceId,
      artifact.generation,
      request.eventId,
      request.handlerVersion,
      request.leaseToken,
    ];
    if (
      artifact.kind === 'youtube_caption' ||
      artifact.kind === 'transcription'
    ) {
      const source = await client.query(
        `UPDATE video_sources AS source
         SET current_source_caption_artifact_id = $1::bigint,
             updated_at = statement_timestamp()
         WHERE source.id = $2::bigint
           AND EXISTS (
             SELECT 1 FROM work_job_claims
             WHERE event_id = $4::uuid AND handler_version = $5
               AND lease_token = $6::uuid
               AND lease_expires_at > statement_timestamp()
           )
           AND (
             source.current_source_caption_artifact_id IS NULL OR
             (SELECT generation FROM caption_artifacts
              WHERE id = source.current_source_caption_artifact_id) < $3
           )`,
        leaseParams,
      );
      if ((source.rowCount ?? 0) !== 1) return false;
      await client.query(
        `UPDATE study_contexts AS context
         SET current_source_caption_artifact_id = $1::bigint,
             current_translation_caption_artifact_id = NULL,
             current_caption_index_artifact_id = NULL,
             updated_at = statement_timestamp()
         FROM learning_items AS item
         JOIN provider_subscription_reservations AS subscription
           ON subscription.state IN ('reserved', 'committed')
         JOIN provider_work_reservations AS work
           ON work.id = subscription.work_reservation_id
          AND work.work_id = $3::uuid
         WHERE context.learning_item_id = item.id
           AND subscription.study_context_id = context.id
           AND item.video_source_id = $2::bigint`,
        [artifact.id, artifact.videoSourceId, request.eventId],
      );
      return true;
    }
    if (artifact.kind === 'translation' && artifact.parentArtifactId) {
      const contexts = await client.query(
        `UPDATE study_contexts AS context
         SET current_translation_caption_artifact_id = $1::bigint,
             current_caption_index_artifact_id = NULL,
             updated_at = statement_timestamp()
         FROM learning_items AS item
         JOIN provider_subscription_reservations AS subscription
           ON subscription.state IN ('reserved', 'committed')
         JOIN provider_work_reservations AS work
           ON work.id = subscription.work_reservation_id
          AND work.work_id = $4::uuid
         WHERE context.learning_item_id = item.id
           AND subscription.study_context_id = context.id
           AND item.video_source_id = $2::bigint
           AND context.current_source_caption_artifact_id = $7::bigint
           AND (
             context.source_language_override IS NULL OR
             context.source_language_override = (
               SELECT source_language FROM caption_artifacts WHERE id = $1::bigint
             )
           )
           AND EXISTS (
             SELECT 1 FROM work_job_claims
             WHERE event_id = $4::uuid AND handler_version = $5
               AND lease_token = $6::uuid
               AND lease_expires_at > statement_timestamp()
           )
           AND (
             context.current_translation_caption_artifact_id IS NULL OR
             (SELECT generation FROM caption_artifacts
              WHERE id = context.current_translation_caption_artifact_id) < $3
           )`,
        [...leaseParams, artifact.parentArtifactId],
      );
      return (contexts.rowCount ?? 0) > 0;
    }
    return false;
  }

  private async isCurrentPointer(
    client: Pick<Pool, 'query'>,
    artifact: ArtifactRow,
    request: CaptionPipelineRequest,
  ): Promise<boolean> {
    if (
      artifact.kind === 'youtube_caption' ||
      artifact.kind === 'transcription'
    ) {
      const result = await client.query<{ current: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM video_sources AS source
           JOIN learning_items AS item ON item.video_source_id = source.id
           JOIN study_contexts AS context ON context.learning_item_id = item.id
           JOIN provider_subscription_reservations AS subscription
             ON subscription.study_context_id = context.id
            AND subscription.state IN ('reserved', 'committed')
           JOIN provider_work_reservations AS work
             ON work.id = subscription.work_reservation_id
            AND work.work_id = $2::uuid
           WHERE source.id = $3::bigint
             AND source.current_source_caption_artifact_id = $1::bigint
             AND context.current_source_caption_artifact_id = $1::bigint
         ) AS current`,
        [artifact.id, request.eventId, artifact.videoSourceId],
      );
      return result.rows[0]?.current === true;
    }
    if (artifact.kind === 'translation') {
      const result = await client.query<{ current: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM study_contexts AS context
           JOIN provider_subscription_reservations AS subscription
             ON subscription.study_context_id = context.id
            AND subscription.state IN ('reserved', 'committed')
           JOIN provider_work_reservations AS work
             ON work.id = subscription.work_reservation_id
            AND work.work_id = $2::uuid
           WHERE context.current_translation_caption_artifact_id = $1::bigint
         ) AS current`,
        [artifact.id, request.eventId],
      );
      return result.rows[0]?.current === true;
    }
    return false;
  }
}

export class CaptionArtifactLeaseLostError extends Error {
  readonly code = 'CAPTION_LEASE_LOST';

  constructor() {
    super('CAPTION_LEASE_LOST');
  }
}

const SAFE_CODES = new Set<CaptionSafeErrorCode>([
  'STT_NOT_APPROVED',
  'STT_DISABLED',
  'VIDEO_LIVE_UNSUPPORTED',
  'VIDEO_RESTRICTED',
  'VIDEO_AUTH_REQUIRED',
  'VIDEO_TOO_LONG',
  'CAPTION_PROVIDER_UNAVAILABLE',
  'TRANSCRIPTION_PROVIDER_UNAVAILABLE',
]);

function providerFor(kind: CaptionArtifactKind): string {
  if (kind === 'youtube_caption') return 'youtube';
  if (kind === 'transcription') return 'openai-fixed-snapshot';
  return 'caption-translation';
}

function validateKind(
  kind: CaptionArtifactKind,
  parentArtifactId: string | undefined,
  targetLanguage: string | undefined,
): void {
  if (!['youtube_caption', 'transcription', 'translation'].includes(kind)) {
    throw new RangeError('kind is invalid');
  }
  if (kind === 'translation') {
    validateDecimalId(parentArtifactId ?? '', 'parentArtifactId');
    if (targetLanguage !== 'ko')
      throw new RangeError('targetLanguage is invalid');
  } else if (parentArtifactId || targetLanguage) {
    throw new RangeError('source generation cannot have a parent or target');
  }
}

function validateRequest(request: CaptionPipelineRequest): void {
  if (!/^[0-9a-f-]{36}$/iu.test(request.eventId))
    throw new RangeError('eventId is invalid');
  if (!/^[0-9a-f-]{36}$/iu.test(request.leaseToken))
    throw new RangeError('leaseToken is invalid');
  if (!request.handlerVersion.trim())
    throw new RangeError('handlerVersion is invalid');
  if (!/^[A-Za-z0-9_-]{11}$/u.test(request.canonicalVideoId)) {
    throw new RangeError('canonicalVideoId is invalid');
  }
  if (request.targetLanguage !== 'ko')
    throw new RangeError('targetLanguage is invalid');
  if (
    !Number.isSafeInteger(request.durationSeconds) ||
    request.durationSeconds < 1 ||
    request.durationSeconds > 14_400
  ) {
    throw new RangeError('durationSeconds is invalid');
  }
}

function validateDecimalId(value: string, name: string): void {
  if (!/^[1-9]\d*$/u.test(value)) throw new RangeError(`${name} is invalid`);
}
