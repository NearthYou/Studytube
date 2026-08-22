import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import {
  COURSE_CUTOVER_ADVISORY_LOCK_KEY,
  type CourseCutoverMode,
} from '../src/course/course-cutover.policy';
import { DatabaseService } from '../src/database.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';
const WEB_ORIGIN =
  process.env.WEB_ORIGIN ?? 'https://app.studytube.example.test';
const ORIGINAL_COURSE_CUTOVER_MODE = process.env.COURSE_CUTOVER_MODE;

describe('Course authority cutover (e2e)', () => {
  jest.setTimeout(60_000);

  let pool: Pool;
  let activeApp: INestApplication<App> | undefined;
  let userId: number | undefined;
  let playlistId: number | undefined;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  it('keeps all admitted writers under one shared lease until they drain', async () => {
    activeApp = await createApplication('legacy');
    const database = activeApp.get(DatabaseService);
    const firstEntered = deferred<void>();
    const secondEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const releaseSecond = deferred<void>();
    let exclusiveClient: PoolClient | undefined;

    const first = database.withCourseWriterSharedLease(async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;
    const second = database.withCourseWriterSharedLease(async () => {
      secondEntered.resolve();
      await releaseSecond.promise;
    });

    try {
      await withTimeout(secondEntered.promise, 2_000);
      exclusiveClient = await pool.connect();
      await expectExclusiveLock(exclusiveClient, false);

      releaseFirst.resolve();
      await first;
      await expectExclusiveLock(exclusiveClient, false);

      releaseSecond.resolve();
      await second;
      await expectExclusiveLock(exclusiveClient, true);
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await Promise.allSettled([first, second]);
      if (exclusiveClient) {
        await exclusiveClient.query('SELECT pg_advisory_unlock($1)', [
          COURSE_CUTOVER_ADVISORY_LOCK_KEY,
        ]);
        exclusiveClient.release();
      }
      await closeActiveApp();
    }
  });

  it('keeps exactly one writer family active and preserves snapshots at activation', async () => {
    const identity = await createIdentity(pool);
    userId = identity.userId;

    const { post, playlist } = await insertLegacySource(pool, userId);
    playlistId = playlist.id;

    activeApp = await createApplication('legacy');
    await request(activeApp.getHttpServer())
      .post('/posts')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({})
      .expect(404);
    const beforeLegacyCourseAttempt = await countOwnerCourses(pool, userId);
    await request(activeApp.getHttpServer())
      .post('/courses')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .set('Idempotency-Key', `legacy-${randomUUID()}`)
      .send(courseInput(post.id))
      .expect(503);
    expect(await countOwnerCourses(pool, userId)).toBe(
      beforeLegacyCourseAttempt,
    );

    await pool.query(
      `
        INSERT INTO course_backfill_audits (
          legacy_playlist_id, order_strategy,
          source_fingerprint, target_fingerprint,
          step_count, feedback_count
        )
        VALUES ($1, 'legacy_position', $2, $3, 1, 0)
      `,
      [playlist.id, Buffer.alloc(32, 1), Buffer.alloc(32, 2)],
    );
    await request(activeApp.getHttpServer())
      .delete(`/posts/${post.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({})
      .expect(404);
    expect(await countPost(pool, post.id)).toBe(1);
    await closeActiveApp();

    activeApp = await createApplication('freeze');
    await request(activeApp.getHttpServer())
      .post('/posts')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({})
      .expect(404);
    await request(activeApp.getHttpServer())
      .post('/playlists')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({ title: 'Frozen', description: '', postIds: [] })
      .expect(404);
    await request(activeApp.getHttpServer())
      .post('/courses')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .set('Idempotency-Key', `freeze-${randomUUID()}`)
      .send(courseInput(post.id))
      .expect(503);
    expect(await countOwnerCourses(pool, userId)).toBe(0);
    await closeActiveApp();

    activeApp = await createApplication('course');
    const course = (
      await request(activeApp.getHttpServer())
        .post('/courses')
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', identity.cookie)
        .set('Idempotency-Key', `course-${randomUUID()}`)
        .send(courseInput(post.id))
        .expect(201)
    ).body as { id: number };

    const playlistCountBeforeRetiredRoute = await countOwnerPlaylists(
      pool,
      userId,
    );
    await request(activeApp.getHttpServer())
      .post('/playlists')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({ title: 'Retired', description: '', postIds: [] })
      .expect(404);
    expect(await countOwnerPlaylists(pool, userId)).toBe(
      playlistCountBeforeRetiredRoute,
    );

    await request(activeApp.getHttpServer())
      .delete(`/posts/${post.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', identity.cookie)
      .send({})
      .expect(404);
    const deletedPost = await pool.query('DELETE FROM posts WHERE id = $1', [
      post.id,
    ]);
    expect(deletedPost.rowCount).toBe(1);

    const preserved = await pool.query<{
      sourcePostId: number | null;
      title: string;
    }>(
      `
        SELECT source_post_id AS "sourcePostId", title_snapshot AS title
        FROM course_steps
        WHERE course_id = $1
      `,
      [course.id],
    );
    expect(preserved.rows).toEqual([{ sourcePostId: null, title: post.title }]);
  });

  afterAll(async () => {
    try {
      await closeActiveApp();
      if (playlistId !== undefined) {
        await pool.query(
          'DELETE FROM course_backfill_audits WHERE legacy_playlist_id = $1',
          [playlistId],
        );
      }
      if (userId !== undefined) {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      await pool.end();
    } finally {
      if (ORIGINAL_COURSE_CUTOVER_MODE === undefined) {
        delete process.env.COURSE_CUTOVER_MODE;
      } else {
        process.env.COURSE_CUTOVER_MODE = ORIGINAL_COURSE_CUTOVER_MODE;
      }
    }
  });

  async function closeActiveApp(): Promise<void> {
    if (activeApp) {
      await activeApp.close();
      activeApp = undefined;
    }
  }
});

async function createApplication(
  mode: CourseCutoverMode,
): Promise<INestApplication<App>> {
  process.env.COURSE_CUTOVER_MODE = mode;
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  configureApplication(app);
  await app.init();
  return app;
}

async function createIdentity(pool: Pool) {
  const suffix = randomUUID();
  const email = `cutover-${suffix}@example.test`;
  const user = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash, password_algorithm,
        password_parameters, password_version, identity_assurance
      )
      VALUES ('Cutover Owner', $1, $1, $2, 'legacy_sha256',
              '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
              1, 'legacy_grandfathered')
      RETURNING id
    `,
    [email, '0'.repeat(64)],
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

function courseInput(sourcePostId: number) {
  return {
    title: 'Native Course authority',
    description: 'Created only after activation',
    steps: [{ sourcePostId }],
  };
}

async function insertLegacySource(pool: Pool, ownerId: number) {
  const post = await pool.query<{ id: number; title: string }>(
    `INSERT INTO posts (
       author_id, title, video_url, thumbnail_url, channel_name,
       summary, translated_notes
     ) VALUES ($1, 'cutover-source',
       'https://www.youtube.com/watch?v=cutover0001', '', 'Cutover Lab',
       'Cutover source', 'Cutover notes')
     RETURNING id, title`,
    [ownerId],
  );
  const playlist = await pool.query<{ id: number }>(
    `INSERT INTO playlists (owner_id, title, description)
     VALUES ($1, 'Legacy authority', 'Audited before activation')
     RETURNING id`,
    [ownerId],
  );
  await pool.query(
    `INSERT INTO playlist_items (playlist_id, post_id, position)
     VALUES ($1, $2, 0)`,
    [playlist.rows[0].id, post.rows[0].id],
  );
  return { post: post.rows[0], playlist: playlist.rows[0] };
}

async function countOwnerCourses(pool: Pool, ownerId: number): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM courses WHERE owner_id = $1',
    [ownerId],
  );
  return result.rows[0]?.count ?? 0;
}

async function countOwnerPlaylists(
  pool: Pool,
  ownerId: number,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM playlists WHERE owner_id = $1',
    [ownerId],
  );
  return result.rows[0]?.count ?? 0;
}

async function countPost(pool: Pool, postId: number): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM posts WHERE id = $1',
    [postId],
  );
  return result.rows[0]?.count ?? 0;
}

async function expectExclusiveLock(
  client: PoolClient,
  expected: boolean,
): Promise<void> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS acquired',
    [COURSE_CUTOVER_ADVISORY_LOCK_KEY],
  );
  expect(result.rows[0]?.acquired).toBe(expected);
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Timed out waiting for admitted writer')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
