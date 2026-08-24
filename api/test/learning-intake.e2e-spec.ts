import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AuthCookiePolicy } from '../src/auth/auth-cookie';
import { AuthService } from '../src/auth/auth.service';
import { OriginGuard } from '../src/auth/origin.guard';
import { SessionGuard } from '../src/auth/session.guard';
import { LEARNING_ITEM_REPOSITORY } from '../src/learning/learning-item.repository';
import type { LearningItemRepository } from '../src/learning/learning-item.repository';
import { LearningItemController } from '../src/learning/learning-item.controller';
import { LearningItemService } from '../src/learning/learning-item.service';
import { LEARNING_NOTE_REPOSITORY } from '../src/learning/learning-note.repository';
import { PostgresLearningItemRepository } from '../src/learning/postgres-learning-item.repository';
import { PostgresLearningNoteRepository } from '../src/learning/postgres-learning-note.repository';
import { PostgresProviderBudgetRepository } from '../src/learning/postgres-provider-budget.repository';
import { PROVIDER_BUDGET_REPOSITORY } from '../src/learning/provider-budget.repository';
import { LearningOverviewService } from '../src/learning/learning-overview.service';
import { PostgresLearningOverviewRepository } from '../src/learning/postgres-learning-overview.repository';
import { LEARNING_OVERVIEW_REPOSITORY } from '../src/learning/learning-overview.repository';
import type { AiProxyService } from '../src/ai-proxy.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';
const WEB_ORIGIN = 'https://app.studytube.example.test';
const BOUNDARY_VIDEO_ID = 'u2testA0001';
const SHARED_VIDEO_ID = 'u2testC0003';

type IntakeResponseBody = {
  reservationId: string;
  workId: string;
  admission: 'created' | 'joined';
  context: { studyContext: { id: string } };
};

type NoteResponseBody = { id: string };

describe('authenticated learning intake', () => {
  let pool: Pool;
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let budget: PostgresProviderBudgetRepository;
  const userIds: number[] = [];
  const tokens = new Map<string, number>();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const items = new PostgresLearningItemRepository(pool);
    const notes = new PostgresLearningNoteRepository(pool);
    const overviews = new PostgresLearningOverviewRepository(pool);
    budget = new PostgresProviderBudgetRepository(pool, {
      enabled: true,
      maxGlobalDailyAudioSeconds: 3_600,
      maxUserDailyAudioSeconds: 1_200,
      maxConcurrentWorks: 2,
      maxConcurrentWorksPerUser: 1,
      microsPerAudioSecond: 1,
      maxGlobalDailyCostMicrounits: 3_600,
    });
    const authService = {
      authenticateSession: (token: string) => {
        const userId = tokens.get(token);
        return Promise.resolve(
          userId
            ? {
                status: 'authenticated' as const,
                principal: { sessionId: token, userId },
                user: {
                  id: userId,
                  name: 'Learning owner',
                  email: `owner-${userId}@example.test`,
                  createdAt: '2026-08-22T00:00:00.000Z',
                },
              }
            : { status: 'invalid' as const },
        );
      },
    };
    const cookies = {
      readSessionCookie: (header: string | undefined) =>
        /(?:^|;\s*)studytube_session=([^;]+)/u.exec(header ?? '')?.[1] ?? null,
    };
    const module = await Test.createTestingModule({
      controllers: [LearningItemController],
      providers: [
        Reflector,
        { provide: LEARNING_ITEM_REPOSITORY, useValue: items },
        { provide: LEARNING_NOTE_REPOSITORY, useValue: notes },
        { provide: LEARNING_OVERVIEW_REPOSITORY, useValue: overviews },
        { provide: PROVIDER_BUDGET_REPOSITORY, useValue: budget },
        {
          provide: LearningItemService,
          useFactory: () => new LearningItemService(budget, items),
        },
        {
          provide: LearningOverviewService,
          useFactory: () =>
            new LearningOverviewService(overviews, {
              explainLearningSegment: jest.fn().mockResolvedValue({
                plainMeaning: '상대에게 천천히 진행하자고 말하는 표현입니다.',
                keyExpressions: [{ text: '你好', meaning: '안녕하세요' }],
                contextNote: '처음 인사하는 장면에서 사용했습니다.',
              }),
            } as unknown as AiProxyService),
        },
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: AuthCookiePolicy,
          useValue: cookies,
        },
        SessionGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalGuards(new OriginGuard(WEB_ORIGIN), app.get(SessionGuard));
    await app.init();
    const httpServer: unknown = app.getHttpServer();
    server = httpServer as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
    if (userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    await pool.query(
      `DELETE FROM caption_artifacts
       WHERE video_source_id IN (
         SELECT id FROM video_sources WHERE canonical_video_id LIKE 'u2test%'
       )`,
    );
    await pool.query(
      `DELETE FROM work_outbox_events
       WHERE event_type = 'learning_summary.requested'`,
    );
    const work = await pool.query<{ workId: string }>(
      `SELECT work_id::text AS "workId"
       FROM provider_work_reservations
       WHERE canonical_video_id LIKE 'u2test%'`,
    );
    const workIds = work.rows.map((row) => row.workId);
    if (workIds.length > 0) {
      await pool.query(
        'DELETE FROM work_outbox_events WHERE id = ANY($1::uuid[])',
        [workIds],
      );
    }
    await pool.query(
      `DELETE FROM provider_work_reservations
       WHERE canonical_video_id LIKE 'u2test%'`,
    );
    await pool.query(
      `DELETE FROM video_sources WHERE canonical_video_id LIKE 'u2test%'`,
    );
    await pool.end();
  });

  it('creates no reservation or durable work for auth, Origin, URL, or cap failures', async () => {
    const firstUser = await insertUser('boundary');
    const token = tokenFor(firstUser);

    await request(server)
      .post('/learning/items/intake')
      .set('Origin', WEB_ORIGIN)
      .send({
        videoUrl: youtube(BOUNDARY_VIDEO_ID),
        requestedAudioSeconds: 600,
      })
      .expect(401);
    await request(server)
      .post('/learning/items/intake')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', cookie(token))
      .send({
        videoUrl: youtube(BOUNDARY_VIDEO_ID),
        requestedAudioSeconds: 600,
      })
      .expect(403);
    await request(server)
      .post('/learning/items/intake')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(token))
      .send({
        videoUrl: 'https://youtube.com.evil.test/watch?v=u2testA0001',
        requestedAudioSeconds: 600,
      })
      .expect(400);
    await expectCounts(BOUNDARY_VIDEO_ID, 0, 0, 0);

    await request(server)
      .post('/learning/items/intake')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(token))
      .send({
        videoUrl: youtube(BOUNDARY_VIDEO_ID),
        requestedAudioSeconds: 600,
      })
      .expect(201);
    await request(server)
      .post('/learning/items/intake')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(token))
      .send({ videoUrl: youtube('u2testB0002'), requestedAudioSeconds: 600 })
      .expect(503);
    await expectCounts('u2testB0002', 0, 0, 0);
  });

  it('shares one durable work while reserving each user quota independently', async () => {
    const firstUser = await insertUser('first');
    const secondUser = await insertUser('second');
    const responses = await Promise.all([
      intake(firstUser, SHARED_VIDEO_ID),
      intake(secondUser, SHARED_VIDEO_ID),
    ]);
    for (const response of responses) expect(response.status).toBe(201);
    const responseBodies = responses.map((response) =>
      responseBody<IntakeResponseBody>(response),
    );

    await expectCounts(SHARED_VIDEO_ID, 1, 2, 1);
    const payload = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT event.payload
       FROM work_outbox_events AS event
       JOIN provider_work_reservations AS work ON work.work_id = event.id
       WHERE work.canonical_video_id = $1`,
      [SHARED_VIDEO_ID],
    );
    expect(payload.rows[0]?.payload).toMatchObject({
      canonicalVideoId: SHARED_VIDEO_ID,
      provider: 'youtube',
    });
    expect(JSON.stringify(payload.rows[0]?.payload)).not.toContain('https://');

    const contextId = responseBodies[0]?.context.studyContext.id ?? '';
    const note = await request(server)
      .post(`/learning/contexts/${contextId}/notes`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(tokenFor(firstUser)))
      .send({ positionSeconds: 12.5, body: '내 메모' })
      .expect(201);
    const noteBody = responseBody<NoteResponseBody>(note);
    await request(server)
      .patch(`/learning/contexts/${contextId}/notes/${noteBody.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(tokenFor(secondUser)))
      .send({ body: '다른 사용자 수정' })
      .expect(404);

    await expect(
      Promise.all([
        budget.releaseSubscription(
          secondUser,
          responseBodies[1]?.reservationId ?? '',
        ),
        budget.releaseSubscription(
          firstUser,
          responseBodies[0]?.reservationId ?? '',
        ),
      ]),
    ).resolves.toEqual([true, true]);
    const released = await pool.query<{ state: string; terminal: boolean }>(
      `SELECT work.state, event.terminal_at IS NOT NULL AS terminal
       FROM provider_work_reservations AS work
       JOIN work_outbox_events AS event ON event.id = work.work_id
       WHERE work.canonical_video_id = $1`,
      [SHARED_VIDEO_ID],
    );
    expect(released.rows[0]).toEqual({ state: 'released', terminal: true });

    const retried = await intake(firstUser, SHARED_VIDEO_ID);
    const retriedBody = responseBody<IntakeResponseBody>(retried);
    expect(retried.status).toBe(201);
    expect(retriedBody).toMatchObject({ admission: 'created' });
    expect(retriedBody).not.toHaveProperty('subscriptionCreated');
    expect(retriedBody.workId).not.toBe(responseBodies[0]?.workId);
    await expectCounts(SHARED_VIDEO_ID, 2, 3, 2);
    await expect(
      budget.releaseSubscription(firstUser, retriedBody.reservationId),
    ).resolves.toBe(true);
  });

  it('compensates a real reservation when context persistence fails', async () => {
    const userId = await insertUser('compensation');
    const failingItems = {
      ensureContext: jest
        .fn()
        .mockRejectedValue(new Error('context unavailable')),
      findOwnerContext: jest.fn(),
    } as LearningItemRepository;
    const service = new LearningItemService(budget, failingItems);

    await expect(
      service.start(userId, {
        videoUrl: youtube('u2testD0004'),
        requestedAudioSeconds: 300,
      }),
    ).rejects.toThrow('context unavailable');
    const state = await pool.query<{
      workState: string;
      subscriptionState: string;
    }>(
      `SELECT work.state AS "workState", subscription.state AS "subscriptionState"
       FROM provider_work_reservations AS work
       JOIN provider_subscription_reservations AS subscription
         ON subscription.work_reservation_id = work.id
       WHERE work.canonical_video_id = 'u2testD0004'`,
    );
    expect(state.rows[0]).toEqual({
      workState: 'released',
      subscriptionState: 'released',
    });
  });

  it('reuses one reservation after a concurrent duplicate and commits actual cost once', async () => {
    const userId = await insertUser('duplicate');
    const responses = await Promise.all([
      intake(userId, 'u2testE0005'),
      intake(userId, 'u2testE0005'),
    ]);
    for (const response of responses) expect(response.status).toBe(201);
    const responseBodies = responses.map((response) =>
      responseBody<IntakeResponseBody>(response),
    );
    expect(
      new Set(responseBodies.map((response) => response.workId)).size,
    ).toBe(1);
    await expectCounts('u2testE0005', 1, 1, 1);

    const workId = responseBodies[0]?.workId ?? '';
    await expect(budget.commitWork(workId, 17)).resolves.toBe(true);
    await expect(budget.commitWork(workId, 99)).resolves.toBe(false);
    const committed = await pool.query<{
      workState: string;
      subscriptionState: string;
      actualCost: string;
    }>(
      `SELECT work.state AS "workState",
              subscription.state AS "subscriptionState",
              work.actual_cost_microunits::text AS "actualCost"
       FROM provider_work_reservations AS work
       JOIN provider_subscription_reservations AS subscription
         ON subscription.work_reservation_id = work.id
       WHERE work.work_id = $1::uuid`,
      [workId],
    );
    expect(committed.rows[0]).toEqual({
      workState: 'committed',
      subscriptionState: 'committed',
      actualCost: '17',
    });
  });

  it('never attaches a new subscriber to a work released concurrently', async () => {
    const firstUser = await insertUser('release-race-first');
    const secondUser = await insertUser('release-race-second');
    const first = await intake(firstUser, 'u2testG0007');
    expect(first.status).toBe(201);
    const firstBody = responseBody<IntakeResponseBody>(first);

    const [, second] = await Promise.all([
      budget.releaseSubscription(firstUser, firstBody.reservationId),
      intake(secondUser, 'u2testG0007'),
    ]);
    expect(second.status).toBe(201);
    const secondBody = responseBody<IntakeResponseBody>(second);
    const invariant = await pool.query<{
      activeWorks: number;
      activeSecondSubscriptions: number;
      subscriptionsOnReleasedWork: number;
    }>(
      `SELECT
         count(DISTINCT work.id) FILTER (
           WHERE work.state IN ('reserved', 'committed')
         )::int AS "activeWorks",
         count(DISTINCT subscription.id) FILTER (
           WHERE subscription.user_id = $2
             AND subscription.state IN ('reserved', 'committed')
             AND work.state IN ('reserved', 'committed')
         )::int AS "activeSecondSubscriptions",
         count(DISTINCT subscription.id) FILTER (
           WHERE subscription.state IN ('reserved', 'committed')
             AND work.state = 'released'
         )::int AS "subscriptionsOnReleasedWork"
       FROM provider_work_reservations AS work
       LEFT JOIN provider_subscription_reservations AS subscription
         ON subscription.work_reservation_id = work.id
       WHERE work.canonical_video_id = $1`,
      ['u2testG0007', secondUser],
    );
    expect(invariant.rows[0]).toEqual({
      activeWorks: 1,
      activeSecondSubscriptions: 1,
      subscriptionsOnReleasedWork: 0,
    });
    await expect(
      budget.releaseSubscription(secondUser, secondBody.reservationId),
    ).resolves.toBe(true);
  });

  it('reads only the owner caption snapshot without calling a provider', async () => {
    const ownerId = await insertUser('caption-owner');
    const otherId = await insertUser('caption-other');
    const source = await pool.query<{ id: string }>(
      `INSERT INTO video_sources (provider, canonical_video_id, canonical_url)
       VALUES ('youtube', 'u2testH0008', $1)
       RETURNING id::text AS id`,
      [youtube('u2testH0008')],
    );
    const sourceId = source.rows[0]?.id;
    if (!sourceId) throw new Error('Expected a video source');
    const item = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2) RETURNING id::text AS id`,
      [ownerId, sourceId],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2, 'standalone') RETURNING id::text AS id`,
      [ownerId, item.rows[0]?.id],
    );
    const contextId = context.rows[0]?.id;
    if (!contextId) throw new Error('Expected a study context');
    const oldWorkId = randomUUID();
    const oldWork = await pool.query<{ id: string }>(
      `INSERT INTO provider_work_reservations (
         work_id, work_key, provider, canonical_video_id,
         processing_range_key, usage_day, state, reserved_audio_seconds,
         estimated_cost_microunits, released_at
       ) VALUES ($1, $2, 'openai', 'u2testH0008', '0:600', current_date,
                 'released', 600, 600, statement_timestamp() - interval '1 minute')
       RETURNING id::text AS id`,
      [oldWorkId, `caption-old-e2e:${oldWorkId}`],
    );
    await pool.query(
      `INSERT INTO provider_subscription_reservations (
         work_reservation_id, user_id, usage_day, state,
         reserved_audio_seconds, study_context_id, released_at
       ) VALUES ($1, $2, current_date, 'released', 600, $3,
                 statement_timestamp() - interval '1 minute')`,
      [oldWork.rows[0]?.id, ownerId, contextId],
    );
    await pool.query(
      `INSERT INTO caption_work_failures (
         work_event_id, handler_version, safe_error_code, created_at
       ) VALUES ($1, 'test-v1', 'CAPTION_PROVIDER_UNAVAILABLE',
                 statement_timestamp() - interval '1 minute')`,
      [oldWorkId],
    );
    const workId = randomUUID();
    const work = await pool.query<{ id: string }>(
      `INSERT INTO provider_work_reservations (
         work_id, work_key, provider, canonical_video_id,
         processing_range_key, usage_day, reserved_audio_seconds,
         estimated_cost_microunits
       ) VALUES ($1, $2, 'openai', 'u2testH0008', '0:600', current_date,
                 600, 600)
       RETURNING id::text AS id`,
      [workId, `caption-e2e:${workId}`],
    );
    await pool.query(
      `INSERT INTO provider_subscription_reservations (
         work_reservation_id, user_id, usage_day, reserved_audio_seconds,
         study_context_id
       ) VALUES ($1, $2, current_date, 600, $3)`,
      [work.rows[0]?.id, ownerId, contextId],
    );

    const pendingResponse = await request(server)
      .get(`/learning/contexts/${contextId}/captions`)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .expect(200);
    expect(pendingResponse.body).toEqual({
      contextId,
      generation: 0,
      phase: 'source_pending',
      sourceLanguage: '',
      sourceSegments: [],
      koreanSegments: [],
      stale: false,
    });

    const sourceArtifact = await pool.query<{ id: string }>(
      `INSERT INTO caption_artifacts (
         video_source_id, kind, generation, source_language, provider,
         work_event_id, handler_version
       ) VALUES ($1, 'youtube_caption', 1, 'zh', 'youtube', $2, 'test-v1')
       RETURNING id::text AS id`,
      [sourceId, workId],
    );
    const sourceArtifactId = sourceArtifact.rows[0]?.id;
    if (!sourceArtifactId) throw new Error('Expected a source artifact');
    await pool.query(
      `INSERT INTO caption_generation_states (artifact_id, status, last_ordinal)
       VALUES ($1, 'partial', 0)`,
      [sourceArtifactId],
    );
    await pool.query(
      `INSERT INTO caption_artifact_segments (
         artifact_id, ordinal, start_seconds, end_seconds, text
       ) VALUES ($1, 0, 0, 4, '你好')`,
      [sourceArtifactId],
    );

    const partialResponse = await request(server)
      .get(`/learning/contexts/${contextId}/captions`)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .expect(200);
    expect(partialResponse.body).toEqual({
      contextId,
      generation: 1,
      phase: 'partial',
      sourceLanguage: 'zh',
      sourceSegments: [{ start: 0, end: 4, text: '你好' }],
      koreanSegments: [],
      stale: false,
    });

    await pool.query(
      `UPDATE caption_generation_states SET status = 'ready'
       WHERE artifact_id = $1`,
      [sourceArtifactId],
    );
    const translationArtifact = await pool.query<{ id: string }>(
      `INSERT INTO caption_artifacts (
         video_source_id, kind, parent_artifact_id, generation,
         source_language, target_language, provider, work_event_id,
         handler_version
       ) VALUES ($1, 'translation', $2, 2, 'zh', 'ko', 'openai', $3, 'test-v1')
       RETURNING id::text AS id`,
      [sourceId, sourceArtifactId, workId],
    );
    const translationArtifactId = translationArtifact.rows[0]?.id;
    if (!translationArtifactId) throw new Error('Expected a translation');
    await pool.query(
      `INSERT INTO caption_generation_states (artifact_id, status, last_ordinal)
       VALUES ($1, 'ready', 0)`,
      [translationArtifactId],
    );
    await pool.query(
      `INSERT INTO caption_artifact_segments (
         artifact_id, ordinal, start_seconds, end_seconds, text
       ) VALUES ($1, 0, 0, 4, '안녕하세요')`,
      [translationArtifactId],
    );
    await pool.query(
      `UPDATE study_contexts
       SET current_source_caption_artifact_id = $1,
           current_translation_caption_artifact_id = $2
       WHERE id = $3`,
      [sourceArtifactId, translationArtifactId, contextId],
    );

    const ownerResponse = await request(server)
      .get(`/learning/contexts/${contextId}/captions`)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .expect(200);
    expect(ownerResponse.body).toEqual({
      contextId,
      generation: 2,
      phase: 'index_pending',
      sourceLanguage: 'zh',
      sourceSegments: [{ start: 0, end: 4, text: '你好' }],
      koreanSegments: [{ start: 0, end: 4, text: '안녕하세요' }],
      stale: false,
    });

    const translationSegment = await pool.query<{ id: string }>(
      `SELECT id::text AS id FROM caption_artifact_segments
       WHERE artifact_id = $1 AND ordinal = 0`,
      [translationArtifactId],
    );
    await pool.query(
      `INSERT INTO retrieval_embeddings (
         source_kind, source_id, owner_id, visibility, model, dimensions,
         content, content_hash, source_url, timestamp_seconds, embedding,
         chunk_index, start_seconds, end_seconds, source_version,
         evidence_kind, resource_id, readiness, evidence_artifact_id,
         evidence_segment_id, artifact_generation
       )
       SELECT 'learning_context', context.id, context.user_id, 'private',
              'test-embedding', 1536, '안녕하세요', $1,
              'https://www.youtube.com/watch?v=u2testH0008', 0,
              array_fill(0.001::real, ARRAY[1536])::vector,
              0, 0, 4, context.retrieval_version,
              'caption_segment', 'caption-segment-1', 'ready', $2, $3, 2
       FROM study_contexts AS context WHERE context.id = $4`,
      [
        createHash('sha256').update('안녕하세요').digest(),
        translationArtifactId,
        translationSegment.rows[0]?.id,
        contextId,
      ],
    );
    await request(server)
      .get(`/learning/contexts/${contextId}/captions`)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ phase: 'complete' }));

    const overviewResponse = await request(server)
      .get(`/learning/contexts/${contextId}/overview`)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .expect(200);
    expect(overviewResponse.body).toEqual({
      contextId,
      status: 'pending',
      coverage: { scope: 'full_video', startSeconds: 0, endSeconds: 4 },
    });
    await request(server)
      .get(`/learning/contexts/${contextId}/overview`)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .expect(200);
    const queuedSummary = await pool.query<{
      summaries: number;
      events: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM learning_context_summaries
          WHERE study_context_id = $1) AS summaries,
         (SELECT count(*)::int FROM work_outbox_events
          WHERE event_type = 'learning_summary.requested'
            AND aggregate_type = 'learning_context_summary') AS events`,
      [contextId],
    );
    expect(queuedSummary.rows[0]).toEqual({ summaries: 1, events: 1 });

    await request(server)
      .post(`/learning/contexts/${contextId}/explanations`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(tokenFor(ownerId)))
      .send({ startSeconds: 0, endSeconds: 4 })
      .expect(201)
      .expect((response) => {
        const body: unknown = response.body;
        if (!body || typeof body !== 'object') {
          throw new Error('Expected explanation response body');
        }
        const explanation = body as Record<string, unknown>;
        expect(typeof explanation.plainMeaning).toBe('string');
        expect(explanation.citation).toEqual({
          startSeconds: 0,
          endSeconds: 4,
        });
      });

    await request(server)
      .get(`/learning/contexts/${contextId}/captions`)
      .set('Cookie', cookie(tokenFor(otherId)))
      .expect(404);
    await request(server)
      .get(`/learning/contexts/${contextId}/overview`)
      .set('Cookie', cookie(tokenFor(otherId)))
      .expect(404);
  });

  async function intake(userId: number, videoId: string) {
    return request(server)
      .post('/learning/items/intake')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie(tokenFor(userId)))
      .send({ videoUrl: youtube(videoId), requestedAudioSeconds: 600 });
  }

  async function expectCounts(
    videoId: string,
    works: number,
    subscriptions: number,
    outbox: number,
  ): Promise<void> {
    const result = await pool.query<{
      works: number;
      subscriptions: number;
      outbox: number;
    }>(
      `SELECT
         count(DISTINCT work.id)::int AS works,
         count(DISTINCT subscription.id)::int AS subscriptions,
         count(DISTINCT event.id)::int AS outbox
       FROM provider_work_reservations AS work
       LEFT JOIN provider_subscription_reservations AS subscription
         ON subscription.work_reservation_id = work.id
       LEFT JOIN work_outbox_events AS event ON event.id = work.work_id
       WHERE work.canonical_video_id = $1`,
      [videoId],
    );
    expect(result.rows[0]).toEqual({ works, subscriptions, outbox });
  }

  async function insertUser(suffix: string): Promise<number> {
    const email = `${suffix}-${randomUUID()}@example.test`;
    const result = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('Learning owner', $1, $1, repeat('a', 64), 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered')
       RETURNING id`,
      [email],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a user');
    userIds.push(id);
    return id;
  }

  function tokenFor(userId: number): string {
    const existing = [...tokens.entries()].find((entry) => entry[1] === userId);
    if (existing) return existing[0];
    const token = `user-${userId}`;
    tokens.set(token, userId);
    return token;
  }
});

function youtube(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function cookie(token: string): string {
  return `studytube_session=${token}`;
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}
