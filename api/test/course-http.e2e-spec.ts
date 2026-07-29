import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';
const WEB_ORIGIN =
  process.env.WEB_ORIGIN ?? 'https://app.studytube.example.test';
const ORIGINAL_COURSE_CUTOVER_MODE = process.env.COURSE_CUTOVER_MODE;

describe('Course HTTP and PostgreSQL boundary (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let pool: Pool;
  const userIds: number[] = [];

  beforeAll(async () => {
    process.env.COURSE_CUTOVER_MODE = 'course';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  it('proves idempotent creation, one-winner edits, public redaction, and feedback bounds', async () => {
    const owner = await createIdentity(pool, 'Course Owner');
    const outsider = await createIdentity(pool, 'Other Learner');
    userIds.push(owner.userId, outsider.userId);
    const key = `course-${randomUUID()}`;
    const payload = {
      title: 'PostgreSQL Concurrency',
      description: 'A backend portfolio course',
      steps: [
        {
          snapshot: {
            title: 'Locks',
            videoUrl: 'https://video.example.test/locks',
            thumbnailUrl: '',
            channelName: 'Database Lab',
          },
        },
        {
          snapshot: {
            title: 'Transactions',
            videoUrl: 'https://video.example.test/transactions',
            thumbnailUrl: 'https://image.example.test/transactions.jpg',
            channelName: 'Database Lab',
          },
        },
      ],
    };

    const createdResponses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/courses')
          .set('Origin', WEB_ORIGIN)
          .set('Cookie', owner.cookie)
          .set('Idempotency-Key', key)
          .send(payload),
      ),
    );
    expect(createdResponses.map(({ status }) => status)).toEqual([201, 201]);
    const created = createdResponses[0].body as CourseResponse;
    expect(createdResponses[1].body).toMatchObject({ id: created.id });
    expect(created).toMatchObject({ status: 'draft', version: 1 });
    expect(created.steps.map(({ position }) => position)).toEqual([1, 2]);

    const persisted = await pool.query<{ roots: number; steps: number }>(
      `
        SELECT count(DISTINCT c.id)::integer AS roots,
               count(cs.id)::integer AS steps
        FROM courses c
        LEFT JOIN course_steps cs ON cs.course_id = c.id
        WHERE c.owner_id = $1 AND c.idempotency_key_digest = $2
      `,
      [owner.userId, createHash('sha256').update(key).digest()],
    );
    expect(persisted.rows[0]).toEqual({ roots: 1, steps: 2 });

    await request(app.getHttpServer())
      .post('/courses')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', key)
      .send({ ...payload, title: 'Different payload' })
      .expect(409);

    const independentlyScoped = await request(app.getHttpServer())
      .post('/courses')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', outsider.cookie)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect((independentlyScoped.body as CourseResponse).id).not.toBe(
      created.id,
    );

    await request(app.getHttpServer())
      .get(`/courses/${created.id}`)
      .set('Cookie', outsider.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/courses/${created.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', outsider.cookie)
      .send({ title: 'Not mine', expectedVersion: 1 })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/explore/courses/${created.id}`)
      .expect(404);

    const competingPatches = await Promise.all(
      ['Winner A', 'Winner B'].map((title) =>
        request(app.getHttpServer())
          .patch(`/courses/${created.id}`)
          .set('Origin', WEB_ORIGIN)
          .set('Cookie', owner.cookie)
          .send({ title, expectedVersion: 1 }),
      ),
    );
    expect(competingPatches.map(({ status }) => status).sort()).toEqual([
      200, 409,
    ]);
    const patchWinner = competingPatches.find(({ status }) => status === 200);
    expect(patchWinner?.body).toMatchObject({ version: 2 });

    const current = (
      await request(app.getHttpServer())
        .get(`/courses/${created.id}`)
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body as CourseResponse;
    const reordered = (
      await request(app.getHttpServer())
        .put(`/courses/${created.id}/steps`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', owner.cookie)
        .send({
          expectedVersion: current.version,
          steps: [
            { stepId: current.steps[1].id },
            { stepId: current.steps[0].id },
          ],
        })
        .expect(200)
    ).body as CourseResponse;
    expect(reordered.steps.map(({ id }) => id)).toEqual([
      current.steps[1].id,
      current.steps[0].id,
    ]);
    expect(reordered.steps.map(({ position }) => position)).toEqual([1, 2]);

    const published = (
      await request(app.getHttpServer())
        .post(`/courses/${created.id}/publish`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', owner.cookie)
        .send({ expectedVersion: reordered.version })
        .expect(201)
    ).body as CourseResponse;
    expect(published).toMatchObject({
      status: 'published',
      visibility: 'public',
    });

    const publicCourse = (
      await request(app.getHttpServer())
        .get(`/explore/courses/${created.id}`)
        .expect(200)
    ).body as unknown;
    expect(publicCourse).toMatchObject({ id: created.id, status: 'published' });
    expect(JSON.stringify(publicCourse)).not.toMatch(
      /ownerId|ownerLearningState|sourcePostId|authorId|email/iu,
    );

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(app.getHttpServer())
        .post(`/courses/${created.id}/feedback`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', outsider.cookie)
        .send({ rating: 5, body: `Feedback ${attempt}` })
        .expect(201);
    }
    const limited = await request(app.getHttpServer())
      .post(`/courses/${created.id}/feedback`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', outsider.cookie)
      .send({ rating: 5, body: 'Feedback 6' })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    const afterFeedback = (
      await request(app.getHttpServer())
        .get(`/courses/${created.id}`)
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body as CourseResponse;
    expect(afterFeedback.version).toBe(published.version);
    expect(afterFeedback.feedback).toHaveLength(5);

    const publicAfterFeedback = (
      await request(app.getHttpServer())
        .get(`/explore/courses/${created.id}`)
        .expect(200)
    ).body as { feedback: Array<Record<string, unknown>> };
    expect(publicAfterFeedback.feedback).toHaveLength(5);
    expect(Object.keys(publicAfterFeedback.feedback[0]).sort()).toEqual([
      'authorName',
      'body',
      'createdAt',
      'id',
      'rating',
    ]);

    const archived = (
      await request(app.getHttpServer())
        .post(`/courses/${created.id}/archive`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', owner.cookie)
        .send({ expectedVersion: published.version })
        .expect(201)
    ).body as CourseResponse;
    expect(archived).toMatchObject({ status: 'archived' });
    await request(app.getHttpServer())
      .get(`/explore/courses/${created.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/courses/${created.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .send({ title: 'Cannot restore', expectedVersion: archived.version })
      .expect(409);
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
      if (ORIGINAL_COURSE_CUTOVER_MODE === undefined) {
        delete process.env.COURSE_CUTOVER_MODE;
      } else {
        process.env.COURSE_CUTOVER_MODE = ORIGINAL_COURSE_CUTOVER_MODE;
      }
    }
  });
});

type CourseResponse = {
  id: number;
  status: string;
  visibility: string;
  version: number;
  steps: Array<{ id: string; position: number }>;
  feedback: unknown[];
};

async function createIdentity(pool: Pool, name: string) {
  const suffix = randomUUID();
  const email = `course-${suffix}@example.test`;
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
