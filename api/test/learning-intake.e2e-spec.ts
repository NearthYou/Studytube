import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
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
        { provide: PROVIDER_BUDGET_REPOSITORY, useValue: budget },
        {
          provide: LearningItemService,
          useFactory: () => new LearningItemService(budget, items),
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
