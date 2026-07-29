import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  CourseLifecycleError,
  CourseVersionConflictError,
} from '../src/course/course.errors';
import { PostgresCourseRepository } from '../src/course/postgres-course.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('Course PostgreSQL concurrency invariants (e2e)', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let repository: PostgresCourseRepository;
  const userIds: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repository = new PostgresCourseRepository(pool);
  });

  it('allows only one publish or last-step removal from the same version', async () => {
    const ownerId = await insertUser(pool, 'Publish Race');
    userIds.push(ownerId);
    const courseId = await insertDraftWithStep(pool, ownerId);
    const blocker = await lockCourse(pool, courseId);
    let transactionOpen = true;
    let contenders: Array<Promise<unknown>> = [];

    try {
      contenders = [
        repository.publish({ ownerId, courseId, expectedVersion: 1 }),
        repository.replaceSteps({
          ownerId,
          courseId,
          expectedVersion: 1,
          steps: [],
        }),
      ];
      await waitForBlockedCourseWriters(pool, courseId, 2);
      await blocker.query('COMMIT');
      transactionOpen = false;
      const settled = await Promise.allSettled(contenders);
      expect(
        settled.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        settled.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      const rejection = settled.find(({ status }) => status === 'rejected');
      if (rejection?.status === 'rejected') {
        expect(
          rejection.reason instanceof CourseVersionConflictError ||
            rejection.reason instanceof CourseLifecycleError,
        ).toBe(true);
      }
    } finally {
      if (transactionOpen) {
        await blocker.query('ROLLBACK');
      }
      await Promise.allSettled(contenders);
      blocker.release();
    }

    const state = await pool.query<{
      status: string;
      version: number;
      stepCount: number;
    }>(
      `
        SELECT c.status, c.version, count(cs.id)::integer AS "stepCount"
        FROM courses c
        LEFT JOIN course_steps cs ON cs.course_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [courseId],
    );
    expect(state.rows[0]?.version).toBe(2);
    expect([
      { status: 'published', version: 2, stepCount: 1 },
      { status: 'draft', version: 2, stepCount: 0 },
    ]).toContainEqual(state.rows[0]);
  });

  it('serializes feedback with archive without orphaning feedback', async () => {
    const ownerId = await insertUser(pool, 'Archive Owner');
    const learnerId = await insertUser(pool, 'Archive Learner');
    userIds.push(ownerId, learnerId);
    const courseId = await insertDraftWithStep(pool, ownerId);
    await pool.query(
      `
        UPDATE courses
        SET status = 'published', visibility = 'public', published_at = now()
        WHERE id = $1
      `,
      [courseId],
    );

    const blocker = await lockCourse(pool, courseId);
    let transactionOpen = true;
    let archive: Promise<unknown> | undefined;
    let feedback: Promise<unknown> | undefined;
    try {
      archive = repository.archive({
        ownerId,
        courseId,
        expectedVersion: 1,
      });
      feedback = repository.addFeedback({
        authorId: learnerId,
        courseId,
        rating: 5,
        body: 'Race-safe feedback',
      });
      await waitForBlockedCourseWriters(pool, courseId, 2);
      await blocker.query('COMMIT');
      transactionOpen = false;
      const [archiveResult, feedbackResult] = await Promise.allSettled([
        archive,
        feedback,
      ]);
      expect(archiveResult.status).toBe('fulfilled');
      if (feedbackResult.status === 'rejected') {
        expect(feedbackResult.reason).toBeInstanceOf(CourseLifecycleError);
      }
    } finally {
      if (transactionOpen) {
        await blocker.query('ROLLBACK');
      }
      const pending: Promise<unknown>[] = [];
      if (archive) pending.push(archive);
      if (feedback) pending.push(feedback);
      await Promise.allSettled(pending);
      blocker.release();
    }

    const state = await pool.query<{
      status: string;
      version: number;
      feedback: number;
    }>(
      `
        SELECT c.status, c.version,
               count(cf.id)::integer AS feedback
        FROM courses c
        LEFT JOIN course_feedback cf ON cf.course_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [courseId],
    );
    expect(state.rows[0]).toMatchObject({ status: 'archived', version: 2 });
    expect([0, 1]).toContain(state.rows[0]?.feedback);
  });

  afterAll(async () => {
    if (pool && userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    await pool?.end();
  });
});

async function insertUser(pool: Pool, name: string): Promise<number> {
  const email = `race-${randomUUID()}@example.test`;
  const result = await pool.query<{ id: number }>(
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
  return result.rows[0].id;
}

async function insertDraftWithStep(
  pool: Pool,
  ownerId: number,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (owner_id, title) VALUES ($1, 'Race Course') RETURNING id`,
      [ownerId],
    );
    await client.query(
      `
        INSERT INTO course_steps (
          course_id, position, title_snapshot, video_url_snapshot,
          owner_learning_state
        )
        VALUES ($1, 1, 'Race Step', 'https://video.example.test/race',
                '{
                  "captionLanguage":"ko","captionsEnabled":true,
                  "playbackRate":1,
                  "loop":{"enabled":false,"manual":false,"start":0,"end":15},
                  "marks":[]
                }'::jsonb)
      `,
      [course.rows[0].id],
    );
    await client.query('COMMIT');
    return course.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function lockCourse(pool: Pool, courseId: number): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM courses WHERE id = $1 FOR UPDATE', [
    courseId,
  ]);
  return client;
}

async function waitForBlockedCourseWriters(
  pool: Pool,
  courseId: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `
        SELECT count(*)::integer AS count
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE $1
      `,
      ['%FROM courses%WHERE id = $1%FOR UPDATE%'],
    );
    if ((result.rows[0]?.count ?? 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Expected ${expected} Course writers to block on Course ${courseId}`,
  );
}
