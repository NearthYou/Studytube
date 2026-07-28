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

describe('application smoke with PostgreSQL (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
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

  it('persists representative board CRUD through a cookie principal', async () => {
    const identity = await seedAuthenticatedUser(pool);
    const initialVideoUrl = `https://example.com/e2e/${RUN_ID}/v1`;
    const updatedVideoUrl = `https://example.com/e2e/${RUN_ID}/v2`;

    const created = await request(app.getHttpServer())
      .post('/posts')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({
        title: 'PostgreSQL CRUD proof',
        videoUrl: initialVideoUrl,
        thumbnailUrl: 'https://example.com/e2e/thumbnail-v1.png',
        channelName: 'E2E channel',
        summary: 'Initial PostgreSQL E2E summary',
        translatedNotes: 'Initial PostgreSQL E2E notes',
        tags: ['postgres-e2e', 'cookie-principal'],
      })
      .expect(201);
    const postId = Number((created.body as { id: unknown }).id);

    expect(postId).toBeGreaterThan(0);
    expect(created.body).toMatchObject({
      authorId: identity.userId,
      title: 'PostgreSQL CRUD proof',
      videoUrl: initialVideoUrl,
    });

    await request(app.getHttpServer())
      .get(`/posts/${postId}`)
      .set('Cookie', identity.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: postId, authorId: identity.userId });
        expect(body.tags).toEqual(
          expect.arrayContaining(['postgres-e2e', 'cookie-principal']),
        );
      });

    await request(app.getHttpServer())
      .put(`/posts/${postId}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({
        title: 'Updated PostgreSQL CRUD proof',
        videoUrl: updatedVideoUrl,
        thumbnailUrl: 'https://example.com/e2e/thumbnail-v2.png',
        channelName: 'Updated E2E channel',
        summary: 'Updated PostgreSQL E2E summary',
        translatedNotes: 'Updated PostgreSQL E2E notes',
        tags: ['crud-updated'],
      })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          id: postId,
          authorId: identity.userId,
          videoUrl: updatedVideoUrl,
        }),
      );

    await request(app.getHttpServer())
      .delete(`/posts/${postId}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .expect(200)
      .expect({ deleted: true });

    await request(app.getHttpServer())
      .get(`/posts/${postId}`)
      .set('Cookie', identity.cookie)
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
