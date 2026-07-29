import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { LearningModule } from '../src/learning/learning.module';
import { LearningService } from '../src/learning/learning.service';
import type {
  AgentRun,
  LearningProgress,
  QuizAttemptResult,
  QuizPublic,
} from '../src/learning/learning.types';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';
const WEB_ORIGIN =
  process.env.WEB_ORIGIN ?? 'https://app.studytube.example.test';

describe('learning HTTP and PostgreSQL boundary (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let pool: Pool;
  let service: LearningService;
  const userIds: number[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, LearningModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    service = app.get(LearningService);
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  it('returns 202 for idempotent AgentRun creation and keeps reads owner-only', async () => {
    const owner = await createIdentity(pool, 'Agent Owner');
    const outsider = await createIdentity(pool, 'Agent Outsider');
    userIds.push(owner.userId, outsider.userId);
    const key = `agent-${randomUUID()}`;
    const payload = {
      objective: 'PostgreSQL 동시성 학습',
      requestedStepCount: 3,
      budgets: {
        wallTimeBudgetMs: 120_000,
        toolCallBudget: 8,
        tokenBudget: 12_000,
        estimatedCostBudgetUsd: 0.2,
      },
    };

    const created = await request(app.getHttpServer())
      .post('/learning/agent-runs')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(202);
    const replay = await request(app.getHttpServer())
      .post('/learning/agent-runs')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(202);
    const createdBody = created.body as AgentRun;
    const replayBody = replay.body as AgentRun;
    expect(replayBody).toMatchObject({ id: createdBody.id, version: 1 });

    await request(app.getHttpServer())
      .post('/learning/agent-runs')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', key)
      .send({ ...payload, objective: 'Different request' })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/learning/agent-runs/${createdBody.id}`)
      .set('Cookie', outsider.cookie)
      .expect(404);
    const cancelled = await request(app.getHttpServer())
      .post(`/learning/agent-runs/${createdBody.id}/cancel`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(
      (cancelled.body as AgentRun).transitions.map(
        (transition) => transition.toState,
      ),
    ).toEqual(['queued', 'cancelled']);
  });

  it('approves cited external steps without enqueueing impossible post asset work', async () => {
    const owner = await createIdentity(pool, 'Approval Owner');
    userIds.push(owner.userId);
    const created = await service.createRun(
      owner.userId,
      `approve-${randomUUID()}`,
      {
        objective: 'Approval Course',
        requestedStepCount: 3,
      },
    );
    const claim = await service.claimRunAttempt('learning-http-worker', 30_000);
    expect(claim?.run.id).toBe(created.id);
    await expect(
      service.reserveRunUsage({
        runId: created.id,
        attemptId: claim!.attemptId,
        leaseToken: claim!.leaseToken,
        expectedVersion: 2,
        usage: { toolCalls: 3, tokens: 900, estimatedCostUsd: 0.03 },
      }),
    ).resolves.toMatchObject({ status: 'reserved' });
    await service.completeRunAttempt({
      runId: created.id,
      attemptId: claim!.attemptId,
      leaseToken: claim!.leaseToken,
      expectedVersion: claim!.run.version,
      usage: { toolCalls: 3, tokens: 900, estimatedCostUsd: 0.03 },
      proposedSteps: proposedSteps(),
    });

    const approved = await request(app.getHttpServer())
      .post(`/learning/agent-runs/${created.id}/approve`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .send({ expectedVersion: claim!.run.version + 1 })
      .expect(200);
    expect(approved.body).toMatchObject({ state: 'approved', version: 4 });

    const persisted = await pool.query<{
      status: string;
      steps: number;
      workItems: number;
      outbox: number;
    }>(
      `
        SELECT c.status,
               count(DISTINCT cs.id)::integer AS steps,
               count(DISTINCT wi.id)::integer AS "workItems",
               count(DISTINCT o.id)::integer AS outbox
        FROM agent_runs r
        JOIN courses c ON c.id = r.course_id
        JOIN course_steps cs ON cs.course_id = c.id
        JOIN agent_run_work_items wi ON wi.run_id = r.id AND wi.kind <> 'proposed_step'
        JOIN work_outbox_events o
          ON o.aggregate_type = 'course_step'
         AND o.aggregate_id = cs.id::text
        WHERE r.id = $1
        GROUP BY c.id
      `,
      [created.id],
    );
    expect(persisted.rows[0]).toEqual({
      status: 'published',
      steps: 3,
      workItems: 6,
      outbox: 6,
    });
  });

  it('keeps quiz answers private until submit and completes only after both thresholds', async () => {
    const owner = await createIdentity(pool, 'Learning Owner');
    const outsider = await createIdentity(pool, 'Learning Observer');
    userIds.push(owner.userId, outsider.userId);
    const stepId = await insertPublishedCourseStep(pool, owner.userId, 100);
    await service.createQuiz({
      courseStepId: stepId,
      schemaVersion: 1,
      generatorVersion: 'learning-http-v1',
      maxAttempts: 3,
      questions: Array.from({ length: 5 }, (_, index) => ({
        prompt: `Question ${index + 1}`,
        choices: ['A', 'B', 'C', 'D'],
        correctChoiceIndex: index % 4,
        explanation: `Explanation ${index + 1}`,
        sourceUrl: `https://video.example.test/learning?t=${index * 10}s`,
        sourceStartSeconds: index * 10,
        sourceEndSeconds: index * 10 + 5,
      })),
    });

    const quiz = await request(app.getHttpServer())
      .get(`/learning/course-steps/${stepId}/quiz`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const quizBody = quiz.body as QuizPublic;
    expect(quizBody.questions).toHaveLength(5);
    expect(JSON.stringify(quizBody)).not.toMatch(
      /correctChoiceIndex|explanation|correct/iu,
    );

    const watched = await request(app.getHttpServer())
      .post(`/learning/course-steps/${stepId}/progress`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', `progress-${randomUUID()}`)
      .send({
        startSeconds: 0,
        endSeconds: 80,
        lastPositionSeconds: 80,
        occurredAt: '2026-07-29T01:00:00.000Z',
      })
      .expect(200);
    expect(watched.body as LearningProgress).toMatchObject({
      watchedCoverage: 0.8,
      completedAt: null,
    });

    const answers = quizBody.questions.map((question, index) => ({
      questionId: question.id,
      selectedChoiceIndex: index % 4,
    }));
    const firstAttemptKey = `quiz-${randomUUID()}`;
    const attempt = await request(app.getHttpServer())
      .post(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', firstAttemptKey)
      .send({ answers })
      .expect(201);
    const attemptBody = attempt.body as QuizAttemptResult;
    expect(attemptBody).toMatchObject({ score: 100, bestScore: 100 });
    expect(attemptBody.answers).toHaveLength(5);
    const replayedAttempt = await request(app.getHttpServer())
      .post(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', firstAttemptKey)
      .send({ answers })
      .expect(201);
    expect(replayedAttempt.body as QuizAttemptResult).toMatchObject({
      id: attemptBody.id,
      attemptNumber: 1,
    });
    await request(app.getHttpServer())
      .post(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', firstAttemptKey)
      .send({
        answers: answers.map((answer, index) =>
          index === 0 ? { ...answer, selectedChoiceIndex: 1 } : answer,
        ),
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', `quiz-${randomUUID()}`)
      .send({
        answers: answers.map((answer, index) =>
          index === 0 ? { ...answer, selectedChoiceIndex: 99 } : answer,
        ),
      })
      .expect(400);

    const secondAttempt = await request(app.getHttpServer())
      .post(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', `quiz-${randomUUID()}`)
      .send({
        answers: quizBody.questions.map((question, index) => ({
          questionId: question.id,
          selectedChoiceIndex: (index + 1) % 4,
        })),
      })
      .expect(201);
    expect(secondAttempt.body as QuizAttemptResult).toMatchObject({
      attemptNumber: 2,
      score: 0,
      bestScore: 100,
      latestScore: 0,
    });

    const progress = await request(app.getHttpServer())
      .get(`/learning/course-steps/${stepId}/progress`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect((progress.body as LearningProgress).completedAt).toEqual(
      expect.any(String),
    );

    const ownerAttempts = await request(app.getHttpServer())
      .get(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(ownerAttempts.body as QuizAttemptResult[]).toHaveLength(2);
    const outsiderAttempts = await request(app.getHttpServer())
      .get(`/learning/quizzes/${quizBody.id}/attempts`)
      .set('Cookie', outsider.cookie)
      .expect(200);
    expect(outsiderAttempts.body as QuizAttemptResult[]).toEqual([]);
    await request(app.getHttpServer())
      .get(`/learning/course-steps/${stepId}/progress`)
      .set('Cookie', outsider.cookie)
      .expect(404);
  });

  afterAll(async () => {
    try {
      if (pool && userIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
          userIds,
        ]);
      }
      await pool?.end();
    } finally {
      await app?.close();
    }
  });
});

function proposedSteps() {
  return Array.from({ length: 3 }, (_, index) => ({
    position: index + 1,
    title: `Step ${index + 1}`,
    videoUrl: `https://www.youtube.com/watch?v=approval${index + 1}`,
    thumbnailUrl: '',
    channelName: 'StudyTube Lab',
    sourcePostId: null,
    evidenceSourceUrl: `https://www.youtube.com/watch?v=approval${index + 1}&t=${index * 10}s`,
    evidenceTimestampSeconds: index * 10,
    evidenceConfidence: 0.9,
    status: 'ready' as const,
    durationSeconds: 100,
  }));
}

async function createIdentity(pool: Pool, name: string) {
  const suffix = randomUUID();
  const email = `learning-http-${suffix}@example.test`;
  const user = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash, password_algorithm,
        password_parameters, password_version, identity_assurance
      )
      VALUES ($1, $2, $2, $3, 'legacy_sha256',
              '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
              1, 'legacy_grandfathered')
      RETURNING id
    `,
    [name, email, '0'.repeat(64)],
  );
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `
      INSERT INTO sessions (
        id, token_digest, user_id, created_at,
        absolute_expires_at, idle_expires_at, last_seen_at
      )
      VALUES ($1, $2, $3, now(), now() + interval '7 days',
              now() + interval '1 day', now())
    `,
    [
      randomUUID(),
      createHash('sha256').update(token).digest(),
      user.rows[0].id,
    ],
  );
  return { userId: user.rows[0].id, cookie: `studytube_session=${token}` };
}

async function insertPublishedCourseStep(
  pool: Pool,
  ownerId: number,
  durationSeconds: number,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (owner_id, title) VALUES ($1, 'HTTP Learning') RETURNING id`,
      [ownerId],
    );
    const step = await client.query<{ id: string }>(
      `
        INSERT INTO course_steps (
          course_id, position, title_snapshot, video_url_snapshot,
          evidence_source_url, evidence_timestamp_seconds,
          evidence_confidence, generation_status, duration_seconds
        )
        VALUES ($1, 1, 'HTTP Step', 'https://video.example.test/learning',
                'https://video.example.test/learning?t=0s', 0, 1, 'ready', $2)
        RETURNING id::text AS id
      `,
      [course.rows[0].id, durationSeconds],
    );
    await client.query(
      `
        UPDATE courses
        SET status = 'published', visibility = 'public',
            published_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [course.rows[0].id],
    );
    await client.query('COMMIT');
    return step.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
