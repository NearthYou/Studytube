import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
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
const RUN_ID = randomUUID();
const ORIGINAL_COURSE_CUTOVER_MODE = process.env.COURSE_CUTOVER_MODE;

describe('application smoke with PostgreSQL (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
    process.env.COURSE_CUTOVER_MODE = 'course';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    pool = new Pool({
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
  });

  it.each([
    ['/health', { service: 'api', status: 'ok' }],
    ['/health/live', { service: 'api', status: 'ok', live: true }],
    [
      '/health/ready',
      {
        service: 'api',
        status: 'ok',
        ready: true,
        dependencies: { database: { ready: true } },
      },
    ],
  ])('keeps %s public and healthy', async (path, expected) => {
    await request(app.getHttpServer())
      .get(path)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject(expected));
  });

  it('persists representative Course CRUD and keeps retired board writes closed', async () => {
    const identity = await seedAuthenticatedUser(pool);
    const idempotencyKey = `smoke-${RUN_ID}`;

    await request(app.getHttpServer())
      .post('/posts')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({})
      .expect(404);

    const created = await request(app.getHttpServer())
      .post('/courses')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        title: 'PostgreSQL Course proof',
        description: 'Cookie-authenticated Course smoke test',
        steps: [
          {
            snapshot: {
              title: 'Learning flow',
              videoUrl: 'https://www.youtube.com/watch?v=smoke000001',
              thumbnailUrl: '',
              channelName: 'StudyTube',
            },
          },
        ],
      })
      .expect(201);
    const courseId = Number((created.body as { id: unknown }).id);

    expect(courseId).toBeGreaterThan(0);
    expect(created.body).toMatchObject({
      ownerId: identity.userId,
      title: 'PostgreSQL Course proof',
      status: 'draft',
      version: 1,
    });

    await request(app.getHttpServer())
      .get(`/courses/${courseId}`)
      .set('Cookie', identity.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ id: courseId, version: 1 }),
      );

    const updated = await request(app.getHttpServer())
      .patch(`/courses/${courseId}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({
        title: 'Updated PostgreSQL Course proof',
        expectedVersion: 1,
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      id: courseId,
      title: 'Updated PostgreSQL Course proof',
      version: 2,
    });

    await request(app.getHttpServer())
      .post(`/courses/${courseId}/archive`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({ expectedVersion: 2 })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({ id: courseId, status: 'archived' }),
      );

    await request(app.getHttpServer())
      .get(`/explore/courses/${courseId}`)
      .expect(404);
  });

  afterAll(async () => {
    try {
      if (pool) {
        await pool.query('DELETE FROM users WHERE email_canonical = $1', [
          `board-smoke-${RUN_ID}@example.test`,
        ]);
        await pool.end();
      }
    } finally {
      if (app) {
        await app.close();
      }
      if (ORIGINAL_COURSE_CUTOVER_MODE === undefined) {
        delete process.env.COURSE_CUTOVER_MODE;
      } else {
        process.env.COURSE_CUTOVER_MODE = ORIGINAL_COURSE_CUTOVER_MODE;
      }
    }
  });
});

async function seedAuthenticatedUser(pool: Pool) {
  const email = `board-smoke-${RUN_ID}@example.test`;
  const passwordHash = createHash('sha256')
    .update('board-smoke-password', 'utf8')
    .digest('hex');
  const inserted = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash,
        password_algorithm, password_parameters, password_version,
        identity_assurance
      )
      VALUES ($1, $2, $2, $3, 'legacy_sha256', $4::jsonb, 1,
              'legacy_grandfathered')
      RETURNING id
    `,
    [
      'Board Smoke User',
      email,
      passwordHash,
      JSON.stringify({ digest: 'sha256', encoding: 'lower_hex' }),
    ],
  );
  const userId = inserted.rows[0]?.id;
  if (!userId) {
    throw new Error('Board smoke user was not inserted');
  }

  const rawSession = randomBytes(32).toString('base64url');
  await pool.query(
    `
      INSERT INTO sessions (
        id, token_digest, user_id, created_at,
        absolute_expires_at, idle_expires_at, last_seen_at
      )
      VALUES (
        $1, $2, $3, statement_timestamp(),
        statement_timestamp() + interval '7 days',
        statement_timestamp() + interval '24 hours',
        statement_timestamp()
      )
    `,
    [randomUUID(), createHash('sha256').update(rawSession).digest(), userId],
  );

  return { userId, cookie: `studytube_session=${rawSession}` };
}
