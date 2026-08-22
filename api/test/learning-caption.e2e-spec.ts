import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresCaptionArtifactRepository } from '../src/postgres-caption-artifact.repository';
import { PostgresProviderBudgetRepository } from '../src/learning/postgres-provider-budget.repository';
import type { CaptionPipelineRequest } from '../src/video-asset.types';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('learning caption artifacts', () => {
  let pool: Pool;
  let repository: PostgresCaptionArtifactRepository;
  const users: number[] = [];
  const sources: string[] = [];
  const events: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repository = new PostgresCaptionArtifactRepository(pool);
  });

  afterAll(async () => {
    if (sources.length > 0) {
      await pool.query(
        `UPDATE video_sources SET current_source_caption_artifact_id = NULL
         WHERE id = ANY($1::bigint[])`,
        [sources],
      );
    }
    if (users.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [users]);
    }
    if (sources.length > 0) {
      await pool.query(
        `DELETE FROM caption_artifacts WHERE video_source_id = ANY($1::bigint[])`,
        [sources],
      );
      await pool.query(
        'DELETE FROM video_sources WHERE id = ANY($1::bigint[])',
        [sources],
      );
    }
    if (events.length > 0) {
      await pool.query(
        'DELETE FROM work_job_claims WHERE event_id = ANY($1::uuid[])',
        [events],
      );
      await pool.query(
        'DELETE FROM caption_work_failures WHERE work_event_id = ANY($1::uuid[])',
        [events],
      );
      await pool.query(
        'DELETE FROM provider_work_reservations WHERE work_id = ANY($1::uuid[])',
        [events],
      );
      await pool.query(
        'DELETE FROM work_outbox_events WHERE id = ANY($1::uuid[])',
        [events],
      );
    }
    await pool.query(
      `DELETE FROM stt_provider_approvals
       WHERE model_snapshot = 'u3-e2e-model'`,
    );
    await pool.end();
  });

  it('makes appended segments visible before lease-fenced publication', async () => {
    const context = await createContext('u3caption01');
    const unrelated = await createContextForSource(context.sourceId);
    const request = await activeRequest('u3caption01', context);
    const artifact = await repository.createGeneration({
      kind: 'youtube_caption',
      sourceLanguage: 'en',
      request,
    });

    await expect(
      repository.appendSegments({
        artifactId: artifact.id,
        request,
        segments: [
          { ordinal: 0, start: 0, end: 2, text: 'first' },
          { ordinal: 1, start: 2, end: 4, text: 'second' },
        ],
      }),
    ).resolves.toBe(true);
    const partial = await pool.query<{ status: string; count: number }>(
      `SELECT state.status, count(segment.id)::integer AS count
       FROM caption_generation_states AS state
       LEFT JOIN caption_artifact_segments AS segment
         ON segment.artifact_id = state.artifact_id
       WHERE state.artifact_id = $1
       GROUP BY state.status`,
      [artifact.id],
    );
    expect(partial.rows[0]).toEqual({ status: 'partial', count: 2 });

    await expect(
      repository.publishGeneration({ artifactId: artifact.id, request }),
    ).resolves.toBe(true);
    const published = await pool.query<{
      sourcePointer: string;
      contextPointer: string;
      status: string;
    }>(
      `SELECT source.current_source_caption_artifact_id::text AS "sourcePointer",
              context.current_source_caption_artifact_id::text AS "contextPointer",
              state.status
       FROM video_sources AS source
       JOIN learning_items AS item ON item.video_source_id = source.id
       JOIN study_contexts AS context ON context.learning_item_id = item.id
       JOIN caption_generation_states AS state ON state.artifact_id = $2
       WHERE context.id = $1`,
      [context.contextId, artifact.id],
    );
    expect(published.rows[0]).toEqual({
      sourcePointer: artifact.id,
      contextPointer: artifact.id,
      status: 'ready',
    });
    await expect(
      repository.appendSegments({
        artifactId: artifact.id,
        request,
        segments: [
          { ordinal: 0, start: 0, end: 2, text: 'first' },
          { ordinal: 1, start: 2, end: 4, text: 'second' },
        ],
      }),
    ).resolves.toBe(true);
    await expect(
      repository.publishGeneration({ artifactId: artifact.id, request }),
    ).resolves.toBe(true);
    const translation = await repository.createGeneration({
      kind: 'translation',
      parentArtifactId: artifact.id,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      request,
    });
    await repository.appendSegments({
      artifactId: translation.id,
      request,
      segments: [{ ordinal: 0, start: 0, end: 2, text: '첫 번째' }],
    });
    await expect(
      repository.publishGeneration({ artifactId: translation.id, request }),
    ).resolves.toBe(true);
    const translated = await pool.query<{ pointer: string | null }>(
      `SELECT current_translation_caption_artifact_id::text AS pointer
       FROM study_contexts WHERE id = $1`,
      [context.contextId],
    );
    expect(translated.rows[0]?.pointer).toBe(translation.id);
    await repository.commitWork({ request, actualCostMicrounits: 0 });
    const untouched = await pool.query<{ pointer: string | null }>(
      `SELECT current_source_caption_artifact_id::text AS pointer
       FROM study_contexts WHERE id = $1`,
      [unrelated.contextId],
    );
    expect(untouched.rows[0]?.pointer).toBeNull();
    await pool.query(
      `UPDATE study_contexts SET source_language_override = 'zh'
       WHERE id = $1`,
      [unrelated.contextId],
    );

    const work = await pool.query<{ id: string }>(
      `SELECT id::text AS id FROM provider_work_reservations
       WHERE work_id = $1`,
      [request.eventId],
    );
    const joined = await pool.query<{ id: string }>(
      `INSERT INTO provider_subscription_reservations (
         work_reservation_id, user_id, usage_day, reserved_audio_seconds
       ) VALUES ($1, $2, current_date, 120) RETURNING id::text AS id`,
      [work.rows[0]?.id, unrelated.userId],
    );
    const budgets = new PostgresProviderBudgetRepository(pool, {
      enabled: true,
      maxGlobalDailyAudioSeconds: 1000,
      maxUserDailyAudioSeconds: 1000,
      maxConcurrentWorks: 10,
      maxConcurrentWorksPerUser: 10,
      microsPerAudioSecond: 1,
      maxGlobalDailyCostMicrounits: 1000,
    });
    await expect(
      budgets.attachContext(
        unrelated.userId,
        joined.rows[0]?.id ?? '',
        unrelated.contextId,
      ),
    ).resolves.toBe(true);
    const hydrated = await pool.query<{
      sourcePointer: string | null;
      translationPointer: string | null;
    }>(
      `SELECT current_source_caption_artifact_id::text AS "sourcePointer",
              current_translation_caption_artifact_id::text AS "translationPointer"
       FROM study_contexts WHERE id = $1`,
      [unrelated.contextId],
    );
    expect(hydrated.rows[0]).toEqual({
      sourcePointer: artifact.id,
      translationPointer: null,
    });
    const joinedState = await pool.query<{ state: string }>(
      `SELECT state FROM provider_subscription_reservations WHERE id = $1`,
      [joined.rows[0]?.id],
    );
    expect(joinedState.rows[0]?.state).toBe('committed');

    const nextReservation = await createDetachedSubscription(
      unrelated.userId,
      'language-correction',
    );
    await expect(
      budgets.attachContext(
        unrelated.userId,
        nextReservation,
        unrelated.contextId,
      ),
    ).resolves.toBe(true);
    const concurrentReservation = await createDetachedSubscription(
      unrelated.userId,
      'concurrent',
    );
    await expect(
      budgets.attachContext(
        unrelated.userId,
        concurrentReservation,
        unrelated.contextId,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects late segments and stale pointer replacement after lease loss', async () => {
    const context = await createContext('u3caption02');
    const stale = await activeRequest('u3caption02', context);
    const oldArtifact = await repository.createGeneration({
      kind: 'youtube_caption',
      sourceLanguage: 'en',
      request: stale,
    });
    await pool.query(
      `UPDATE work_job_claims SET lease_token = $3
       WHERE event_id = $1 AND handler_version = $2`,
      [stale.eventId, stale.handlerVersion, randomUUID()],
    );

    await expect(
      repository.appendSegments({
        artifactId: oldArtifact.id,
        request: stale,
        segments: [{ ordinal: 0, start: 0, end: 1, text: 'late' }],
      }),
    ).resolves.toBe(false);
    await expect(
      repository.publishGeneration({
        artifactId: oldArtifact.id,
        request: stale,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.createGeneration({
        kind: 'transcription',
        sourceLanguage: 'en',
        request: stale,
      }),
    ).rejects.toMatchObject({ code: 'CAPTION_LEASE_LOST' });
    const count = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM caption_artifact_segments
       WHERE artifact_id = $1`,
      [oldArtifact.id],
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('enforces parent lineage and non-overlapping immutable segment ranges', async () => {
    const first = await createContext('u3caption03');
    const second = await createContext('u3caption04');
    const request = await activeRequest('u3caption03', first);
    const source = await repository.createGeneration({
      kind: 'youtube_caption',
      sourceLanguage: 'en',
      request,
    });
    await expect(
      pool.query(
        `INSERT INTO caption_artifacts (
           video_source_id, kind, parent_artifact_id, generation,
           source_language, target_language, provider, work_event_id,
           handler_version
         ) VALUES ($1, 'translation', $2, 1, 'en', 'ko', 'test', $3, 'test')`,
        [second.sourceId, source.id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await expect(
      repository.appendSegments({
        artifactId: source.id,
        request,
        segments: [
          { ordinal: 0, start: 0, end: 3, text: 'first' },
          { ordinal: 1, start: 2, end: 4, text: 'overlap' },
        ],
      }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(first.sourceId).not.toBe(second.sourceId);
  });

  it('keeps STT disabled until a current model-specific approval exists', async () => {
    await expect(repository.hasActiveSttApproval('u3-e2e-model')).resolves.toBe(
      false,
    );
    await pool.query(
      `INSERT INTO stt_provider_approvals (
         model_snapshot, max_spend_microunits, approved_at, expires_at
       ) VALUES ('u3-e2e-model', 1000, statement_timestamp(),
                 statement_timestamp() + interval '1 hour')`,
    );
    await expect(repository.hasActiveSttApproval('u3-e2e-model')).resolves.toBe(
      true,
    );
  });

  it('persists only allowlisted failure codes, never raw provider details', async () => {
    const context = await createContext('u3caption05');
    const request = await activeRequest('u3caption05', context);
    await repository.failGeneration({ request, errorCode: 'STT_NOT_APPROVED' });
    const failure = await pool.query<{ safeErrorCode: string }>(
      `SELECT safe_error_code AS "safeErrorCode" FROM caption_work_failures
       WHERE work_event_id = $1 AND handler_version = $2`,
      [request.eventId, request.handlerVersion],
    );
    expect(failure.rows[0]?.safeErrorCode).toBe('STT_NOT_APPROVED');
    expect(JSON.stringify(failure.rows)).not.toContain('Bearer');
    const released = await pool.query<{
      workState: string;
      subscriptionState: string;
    }>(
      `SELECT work.state AS "workState", subscription.state AS "subscriptionState"
       FROM provider_work_reservations AS work
       JOIN provider_subscription_reservations AS subscription
         ON subscription.work_reservation_id = work.id
       WHERE work.work_id = $1`,
      [request.eventId],
    );
    expect(released.rows[0]).toEqual({
      workState: 'released',
      subscriptionState: 'released',
    });
    await expect(
      pool.query(
        `INSERT INTO caption_work_failures (
           work_event_id, handler_version, safe_error_code
         ) VALUES ($1, 'bad', $2)`,
        [randomUUID(), 'Bearer secret https://u:p@example.invalid/?token=x'],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  async function createContext(videoId: string): Promise<{
    sourceId: string;
    contextId: string;
    userId: number;
  }> {
    const email = `${videoId}-${randomUUID()}@example.test`;
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('U3 owner', $1, $1, repeat('a', 64), 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered') RETURNING id`,
      [email],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error('Expected a user');
    users.push(userId);
    const source = await pool.query<{ id: string }>(
      `INSERT INTO video_sources (provider, canonical_video_id, canonical_url)
       VALUES ('youtube', $1, $2) RETURNING id::text AS id`,
      [videoId, `https://www.youtube.com/watch?v=${videoId}`],
    );
    const sourceId = source.rows[0]?.id;
    if (!sourceId) throw new Error('Expected a source');
    sources.push(sourceId);
    const item = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2) RETURNING id::text AS id`,
      [userId, sourceId],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2, 'standalone') RETURNING id::text AS id`,
      [userId, item.rows[0]?.id],
    );
    const contextId = context.rows[0]?.id;
    if (!contextId) throw new Error('Expected a context');
    return { sourceId, contextId, userId };
  }

  async function createContextForSource(sourceId: string): Promise<{
    contextId: string;
    userId: number;
  }> {
    const email = `other-${randomUUID()}@example.test`;
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('Other owner', $1, $1, repeat('a', 64), 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered') RETURNING id`,
      [email],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error('Expected another user');
    users.push(userId);
    const item = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2) RETURNING id::text AS id`,
      [userId, sourceId],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2, 'standalone') RETURNING id::text AS id`,
      [userId, item.rows[0]?.id],
    );
    const id = context.rows[0]?.id;
    if (!id) throw new Error('Expected another context');
    return { contextId: id, userId };
  }

  async function activeRequest(
    videoId: string,
    context: { sourceId: string; contextId: string; userId: number },
  ): Promise<CaptionPipelineRequest> {
    const eventId = randomUUID();
    const leaseToken = randomUUID();
    const handlerVersion = 'learning-caption-v1';
    events.push(eventId);
    const work = await pool.query<{ id: string }>(
      `INSERT INTO provider_work_reservations (
         work_id, work_key, provider, canonical_video_id,
         processing_range_key, usage_day, reserved_audio_seconds,
         estimated_cost_microunits
       ) VALUES ($1, $2, 'youtube', $3, '0-120', current_date, 120, 120)
       RETURNING id::text AS id`,
      [eventId, `u3-e2e:${eventId}`, videoId],
    );
    await pool.query(
      `INSERT INTO provider_subscription_reservations (
         work_reservation_id, user_id, usage_day, reserved_audio_seconds,
         study_context_id
       ) VALUES ($1, $2, current_date, 120, $3)`,
      [work.rows[0]?.id, context.userId, context.contextId],
    );
    await pool.query(
      `INSERT INTO work_outbox_events (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         payload_schema_version, payload
       ) VALUES ($1, 'learning_intake.requested', 'provider_work', $2, 1, 1,
                 $3::jsonb)`,
      [
        eventId,
        work.rows[0]?.id,
        JSON.stringify({ canonicalVideoId: videoId }),
      ],
    );
    await pool.query(
      `INSERT INTO work_job_claims (
         event_id, handler_version, lease_owner, lease_token, lease_expires_at
       ) VALUES ($1, $2, 'u3-e2e', $3,
                 statement_timestamp() + interval '10 minutes')`,
      [eventId, handlerVersion, leaseToken],
    );
    return {
      eventId,
      handlerVersion,
      leaseToken,
      canonicalVideoId: videoId,
      targetLanguage: 'ko',
      durationSeconds: 120,
    };
  }

  async function createDetachedSubscription(
    userId: number,
    suffix: string,
  ): Promise<string> {
    const workId = randomUUID();
    events.push(workId);
    const work = await pool.query<{ id: string }>(
      `INSERT INTO provider_work_reservations (
         work_id, work_key, provider, canonical_video_id,
         processing_range_key, usage_day, reserved_audio_seconds,
         estimated_cost_microunits
       ) VALUES ($1, $2, 'youtube', 'u3caption01', $3,
                 current_date, 120, 120)
       RETURNING id::text AS id`,
      [workId, `u3-e2e:${workId}`, `0-120-${suffix}`],
    );
    const subscription = await pool.query<{ id: string }>(
      `INSERT INTO provider_subscription_reservations (
         work_reservation_id, user_id, usage_day, reserved_audio_seconds
       ) VALUES ($1, $2, current_date, 120) RETURNING id::text AS id`,
      [work.rows[0]?.id, userId],
    );
    const id = subscription.rows[0]?.id;
    if (!id) throw new Error('Expected a detached subscription');
    return id;
  }
});
