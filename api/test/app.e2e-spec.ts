import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { synchronizeSequences } from '../scripts/seed-demo';

describe('AppController (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  const testEmail = `postgres-e2e-${randomUUID()}@example.test`;
  const raceEmail = `postgres-race-${randomUUID()}@example.test`;
  const loginFirstRaceEmail = `postgres-login-first-race-${randomUUID()}@example.test`;
  const seedLockEmail = `postgres-seed-lock-${randomUUID()}@example.test`;
  const sessionRotationEmail = `postgres-session-rotation-${randomUUID()}@example.test`;
  const concurrentPasswordEmail = `postgres-concurrent-password-${randomUUID()}@example.test`;

  async function waitForBlockedQuery(
    pool: Pool,
    queryPattern: string,
    description: string,
  ) {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const result = await pool.query<{ blocked: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND state = 'active'
              AND wait_event_type = 'Lock'
              AND query LIKE $1
          ) AS blocked
        `,
        [queryPattern],
      );

      if (result.rows[0]?.blocked === true) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Timed out waiting for ${description}`);
  }

  function waitForBlockedAuthenticatedSession(pool: Pool) {
    return waitForBlockedQuery(
      pool,
      '%WITH matching_user AS MATERIALIZED%',
      'the authenticated session row lock',
    );
  }

  function waitForBlockedPasswordChange(pool: Pool) {
    return waitForBlockedQuery(
      pool,
      '%password_change_user_lock%',
      'the password change user row lock',
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          service: 'api',
          status: 'ok',
        });
      });
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          service: 'api',
          status: 'ok',
          live: true,
        });
      });
  });

  it('/health/ready (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          service: 'api',
          status: 'ok',
          ready: true,
          dependencies: {
            database: {
              ready: true,
              database: 'postgresql + pgvector',
            },
          },
        });
      });
  });

  it('preserves a transactional sequence restart ahead of existing ids', async () => {
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER SEQUENCE public.users_id_seq RESTART WITH 2000000000',
      );
      await synchronizeSequences(client);

      const state = await client.query<{
        lastValue: string;
        isCalled: boolean;
      }>(`
        SELECT last_value::text AS "lastValue", is_called AS "isCalled"
        FROM public.users_id_seq
      `);

      expect(state.rows[0]).toEqual({
        lastValue: '2000000000',
        isCalled: false,
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('persists post CRUD and hydrates its tag and comment relations', async () => {
    const testUserName = 'PostgreSQL E2E User';
    const password = 'postgres-e2e-password';
    const initialTags = ['postgres-e2e', 'relation-hydration'];
    const initialVideoUrl = 'https://example.com/e2e/post-v1';
    const updatedTags = ['crud-updated', 'postgres-e2e'];
    const updatedVideoUrl = 'https://example.com/e2e/post-v2';

    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: testUserName,
        email: testEmail,
        password,
      })
      .expect(201);
    const signUpBody = signUpResponse.body as {
      token: string;
      user: { id: number; name: string; email: string };
    };

    expect(signUpBody.token).toEqual(expect.any(String));
    expect(signUpBody.token.length).toBeGreaterThan(0);
    expect(signUpBody.user).toMatchObject({
      name: testUserName,
      email: testEmail,
    });
    expect(signUpBody.user.id).toBeGreaterThan(0);

    const authorization = `Bearer ${signUpBody.token}`;
    const createResponse = await request(app.getHttpServer())
      .post('/posts')
      .set('Authorization', authorization)
      .send({
        title: 'PostgreSQL CRUD E2E post',
        videoUrl: initialVideoUrl,
        thumbnailUrl: 'https://example.com/e2e/thumbnail-v1.png',
        channelName: 'E2E channel',
        summary: 'Initial PostgreSQL E2E summary',
        translatedNotes: 'Initial PostgreSQL E2E notes',
        tags: initialTags,
      })
      .expect(201);
    const createdPost = createResponse.body as {
      id: number;
      authorId: number;
    };

    expect(createdPost.id).toBeGreaterThan(0);
    expect(createdPost.authorId).toBe(signUpBody.user.id);
    expect(createResponse.body).toMatchObject({
      title: 'PostgreSQL CRUD E2E post',
      videoUrl: initialVideoUrl,
    });

    const commentResponse = await request(app.getHttpServer())
      .post(`/posts/${createdPost.id}/comments`)
      .set('Authorization', authorization)
      .send({ body: 'PostgreSQL relation hydration comment' })
      .expect(201);
    const createdComment = commentResponse.body as {
      id: number;
      postId: number;
      authorId: number;
    };

    expect(createdComment.id).toBeGreaterThan(0);
    expect(createdComment).toMatchObject({
      postId: createdPost.id,
      authorId: signUpBody.user.id,
    });

    const readResponse = await request(app.getHttpServer())
      .get(`/posts/${createdPost.id}`)
      .set('Authorization', authorization)
      .expect(200);
    const readPost = readResponse.body as {
      tags: string[];
      comments: Array<{
        id: number;
        postId: number;
        authorId: number;
        authorName: string;
        body: string;
      }>;
    };

    expect(readPost.tags).toHaveLength(initialTags.length);
    expect(readPost.tags).toEqual(expect.arrayContaining(initialTags));
    expect(readPost.comments).toHaveLength(1);
    expect(readPost.comments[0]).toMatchObject({
      id: createdComment.id,
      postId: createdPost.id,
      authorId: signUpBody.user.id,
      authorName: testUserName,
      body: 'PostgreSQL relation hydration comment',
    });

    await request(app.getHttpServer())
      .put(`/posts/${createdPost.id}`)
      .set('Authorization', authorization)
      .send({
        title: 'Updated PostgreSQL CRUD E2E post',
        videoUrl: updatedVideoUrl,
        thumbnailUrl: 'https://example.com/e2e/thumbnail-v2.png',
        channelName: 'Updated E2E channel',
        summary: 'Updated PostgreSQL E2E summary',
        translatedNotes: 'Updated PostgreSQL E2E notes',
        tags: updatedTags,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: createdPost.id,
          title: 'Updated PostgreSQL CRUD E2E post',
          videoUrl: updatedVideoUrl,
        });
      });

    const updatedReadResponse = await request(app.getHttpServer())
      .get(`/posts/${createdPost.id}`)
      .set('Authorization', authorization)
      .expect(200);
    const updatedPost = updatedReadResponse.body as {
      tags: string[];
      comments: Array<{ id: number }>;
    };

    expect(updatedReadResponse.body).toMatchObject({
      id: createdPost.id,
      title: 'Updated PostgreSQL CRUD E2E post',
      videoUrl: updatedVideoUrl,
      summary: 'Updated PostgreSQL E2E summary',
      translatedNotes: 'Updated PostgreSQL E2E notes',
    });
    expect(updatedPost.tags).toHaveLength(updatedTags.length);
    expect(updatedPost.tags).toEqual(expect.arrayContaining(updatedTags));
    expect(updatedPost.comments).toContainEqual(
      expect.objectContaining({ id: createdComment.id }),
    );

    await request(app.getHttpServer())
      .delete(`/posts/${createdPost.id}`)
      .set('Authorization', authorization)
      .expect(200)
      .expect({ deleted: true });

    await request(app.getHttpServer())
      .get(`/posts/${createdPost.id}`)
      .set('Authorization', authorization)
      .expect(404);
  });

  it('queues password change before login and rejects the stale password', async () => {
    const password = 'postgres-race-password';
    const nextPassword = 'postgres-race-password-next';
    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'PostgreSQL Race User',
        email: raceEmail,
        password,
      })
      .expect(201);
    const signUpBody = signUpResponse.body as {
      token: string;
      user: { id: number };
    };
    const userId = signUpBody.user.id;
    const racePool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
    const seedClient = await racePool.connect();
    let transactionOpen = false;

    try {
      await seedClient.query('BEGIN');
      transactionOpen = true;
      await seedClient.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        userId,
      ]);

      const passwordChangePromise = request(app.getHttpServer())
        .put('/me')
        .set('Authorization', `Bearer ${signUpBody.token}`)
        .send({ currentPassword: password, password: nextPassword })
        .then((response) => response);

      await waitForBlockedPasswordChange(racePool);

      // The password change is deliberately first in the user-row lock queue.
      const loginPromise = request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: raceEmail, password })
        .then((response) => response);

      await waitForBlockedAuthenticatedSession(racePool);
      await seedClient.query('COMMIT');
      transactionOpen = false;

      const [passwordChangeResponse, loginResponse] = await Promise.all([
        passwordChangePromise,
        loginPromise,
      ]);
      expect(passwordChangeResponse.status).toBe(200);
      expect(loginResponse.status).toBe(401);

      const sessions = await racePool.query<{ token: string }>(
        'SELECT token FROM sessions WHERE user_id = $1',
        [userId],
      );
      expect(sessions.rows).toEqual([{ token: signUpBody.token }]);
    } finally {
      if (transactionOpen) {
        await seedClient.query('ROLLBACK');
      }

      seedClient.release();
      await racePool.end();
    }
  });

  it('queues login before password change and revokes the newly created session', async () => {
    const password = 'postgres-login-first-password';
    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'PostgreSQL Login First Race User',
        email: loginFirstRaceEmail,
        password,
      })
      .expect(201);
    const signUpBody = signUpResponse.body as {
      token: string;
      user: { id: number };
    };
    const userId = signUpBody.user.id;
    const racePool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
    const seedClient = await racePool.connect();
    let transactionOpen = false;

    try {
      await seedClient.query('BEGIN');
      transactionOpen = true;
      await seedClient.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        userId,
      ]);

      const loginPromise = request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: loginFirstRaceEmail, password })
        .then((response) => response);

      await waitForBlockedAuthenticatedSession(racePool);

      // The login is deliberately first in the user-row lock queue.
      const passwordChangePromise = request(app.getHttpServer())
        .put('/me')
        .set('Authorization', `Bearer ${signUpBody.token}`)
        .send({
          currentPassword: password,
          password: 'postgres-login-first-password-next',
        })
        .then((response) => response);

      await waitForBlockedPasswordChange(racePool);
      await seedClient.query('COMMIT');
      transactionOpen = false;

      const [loginResponse, passwordChangeResponse] = await Promise.all([
        loginPromise,
        passwordChangePromise,
      ]);
      expect(loginResponse.status).toBe(201);
      expect(passwordChangeResponse.status).toBe(200);
      const loginBody = loginResponse.body as { token: string };

      await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${loginBody.token}`)
        .expect(401);

      const sessions = await racePool.query<{ token: string }>(
        'SELECT token FROM sessions WHERE user_id = $1',
        [userId],
      );
      expect(sessions.rows).toEqual([{ token: signUpBody.token }]);
    } finally {
      if (transactionOpen) {
        await seedClient.query('ROLLBACK');
      }

      seedClient.release();
      await racePool.end();
    }
  });

  it('waits for the seed users table lock before acquiring the password-change row lock', async () => {
    const password = 'postgres-seed-lock-password';
    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'PostgreSQL Seed Lock User',
        email: seedLockEmail,
        password,
      })
      .expect(201);
    const signUpBody = signUpResponse.body as {
      token: string;
      user: { id: number };
    };
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
    const seedClient = await pool.connect();
    let transactionOpen = false;

    try {
      await seedClient.query('BEGIN');
      transactionOpen = true;
      await seedClient.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      await seedClient.query("SET LOCAL lock_timeout = '2s'");

      const passwordChangePromise = request(app.getHttpServer())
        .put('/me')
        .set('Authorization', `Bearer ${signUpBody.token}`)
        .send({
          currentPassword: password,
          password: 'postgres-seed-lock-password-next',
        })
        .then((response) => response);

      await waitForBlockedPasswordChange(pool);

      const rowLock = await seedClient.query<{ id: number }>(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [signUpBody.user.id],
      );
      expect(rowLock.rows).toEqual([{ id: signUpBody.user.id }]);

      await seedClient.query('COMMIT');
      transactionOpen = false;

      const passwordChangeResponse = await passwordChangePromise;
      expect(passwordChangeResponse.status).toBe(200);
    } finally {
      if (transactionOpen) {
        await seedClient.query('ROLLBACK');
      }

      seedClient.release();
      await pool.end();
    }
  });

  it('replaces every other PostgreSQL session when changing a password', async () => {
    const password = 'postgres-session-password';
    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'PostgreSQL Session User',
        email: sessionRotationEmail,
        password,
      })
      .expect(201);
    const currentSession = signUpResponse.body as {
      token: string;
      user: { id: number };
    };
    const oldSessionResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: sessionRotationEmail, password })
      .expect(201);
    const oldSession = oldSessionResponse.body as { token: string };

    await request(app.getHttpServer())
      .put('/me')
      .set('Authorization', `Bearer ${currentSession.token}`)
      .send({
        currentPassword: password,
        password: 'postgres-session-password-next',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ email: sessionRotationEmail });
      });

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${currentSession.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${oldSession.token}`)
      .expect(401);

    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });

    try {
      const sessions = await pool.query<{ token: string }>(
        'SELECT token FROM sessions WHERE user_id = $1',
        [currentSession.user.id],
      );
      expect(sessions.rows).toEqual([{ token: currentSession.token }]);
    } finally {
      await pool.end();
    }
  });

  it('allows only one concurrent PostgreSQL password change to succeed', async () => {
    const password = 'postgres-concurrent-password';
    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'PostgreSQL Concurrent Password User',
        email: concurrentPasswordEmail,
        password,
      })
      .expect(201);
    const firstSession = signUpResponse.body as {
      token: string;
      user: { id: number };
    };
    const secondSessionResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: concurrentPasswordEmail, password })
      .expect(201);
    const secondSession = secondSessionResponse.body as { token: string };

    const responses = await Promise.all([
      request(app.getHttpServer())
        .put('/me')
        .set('Authorization', `Bearer ${firstSession.token}`)
        .send({ currentPassword: password, password: 'first-winner-password' }),
      request(app.getHttpServer())
        .put('/me')
        .set('Authorization', `Bearer ${secondSession.token}`)
        .send({
          currentPassword: password,
          password: 'second-winner-password',
        }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);

    const winningIndex = responses[0].status === 200 ? 0 : 1;
    const winningToken =
      winningIndex === 0 ? firstSession.token : secondSession.token;
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });

    try {
      const sessions = await pool.query<{ token: string }>(
        'SELECT token FROM sessions WHERE user_id = $1',
        [firstSession.user.id],
      );
      expect(sessions.rows).toEqual([{ token: winningToken }]);
    } finally {
      await pool.end();
    }
  });

  afterAll(async () => {
    const cleanupPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });

    try {
      await cleanupPool.query(
        'DELETE FROM users WHERE email = ANY($1::text[])',
        [
          [
            testEmail,
            raceEmail,
            loginFirstRaceEmail,
            seedLockEmail,
            sessionRotationEmail,
            concurrentPasswordEmail,
          ],
        ],
      );
    } finally {
      try {
        await cleanupPool.end();
      } finally {
        if (app) {
          await app.close();
        }
      }
    }
  });
});
