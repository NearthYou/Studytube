import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('Course aggregate schema', () => {
  let pool: Pool;
  const ownerIds: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (ownerIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        ownerIds,
      ]);
    }

    await pool.end();
  });

  it('accepts paired-null legacy digests and rejects partial native digests', async () => {
    const ownerId = await insertUser(pool, ownerIds, 'digest-owner');
    const legacy = await pool.query<{ id: number; version: number }>(
      `
        INSERT INTO courses (owner_id, title, description)
        VALUES ($1, 'Legacy Course', '')
        RETURNING id, version
      `,
      [ownerId],
    );

    expect(legacy.rows[0]).toMatchObject({ version: 1 });
    expect(legacy.rows[0]?.id).toEqual(expect.any(Number));

    await expect(
      pool.query(
        `
          INSERT INTO courses (
            owner_id, title, description, idempotency_key_digest
          )
          VALUES ($1, 'Invalid native Course', '', decode(repeat('ab', 32), 'hex'))
        `,
        [ownerId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'courses_idempotency_digest_pair_valid',
    });
  });

  it('rejects gapped positions and an empty published Course at commit', async () => {
    const ownerId = await insertUser(pool, ownerIds, 'invariant-owner');
    const courseId = await insertCourse(pool, ownerId, 'Invariant Course');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await insertSnapshotStep(client, courseId, 1, 'First');
      await insertSnapshotStep(client, courseId, 3, 'Third');

      await expect(client.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
        constraint: 'course_steps_positions_contiguous',
      });
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(
        `
          UPDATE courses
          SET status = 'published',
              visibility = 'public',
              published_at = now(),
              updated_at = now()
          WHERE id = $1
        `,
        [courseId],
      );

      await expect(client.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
        constraint: 'courses_published_nonempty',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rejects deletion of the last published step but permits Course cascade delete', async () => {
    const ownerId = await insertUser(pool, ownerIds, 'published-owner');
    const courseId = await insertCourse(pool, ownerId, 'Published Course');
    await insertSnapshotStep(pool, courseId, 1, 'Only step');
    await pool.query(
      `
        UPDATE courses
        SET status = 'published',
            visibility = 'public',
            published_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [courseId],
    );

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM course_steps WHERE course_id = $1', [
        courseId,
      ]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
        constraint: 'courses_published_nonempty',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    await expect(
      pool.query('DELETE FROM courses WHERE id = $1', [courseId]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('nulls a deleted source reference while preserving its snapshot and order', async () => {
    const ownerId = await insertUser(pool, ownerIds, 'snapshot-owner');
    const post = await pool.query<{ id: number }>(
      `
        INSERT INTO posts (
          author_id, title, video_url, thumbnail_url, channel_name,
          summary, translated_notes
        )
        VALUES (
          $1, 'Source post', 'https://video.example/source',
          'https://image.example/source.jpg', 'Source channel', '', ''
        )
        RETURNING id
      `,
      [ownerId],
    );
    const postId = post.rows[0]?.id;

    if (!postId) {
      throw new Error('Expected a source post ID');
    }

    const courseId = await insertCourse(pool, ownerId, 'Snapshot Course');
    await pool.query(
      `
        INSERT INTO course_steps (
          course_id, source_post_id, position, title_snapshot,
          video_url_snapshot, thumbnail_url_snapshot, channel_name_snapshot,
          owner_learning_state
        )
        VALUES (
          $1, $2, 1, 'Source post', 'https://video.example/source',
          'https://image.example/source.jpg', 'Source channel',
          '{"marks":[{"at":12,"note":"keep"}]}'::jsonb
        )
      `,
      [courseId, postId],
    );

    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);

    const step = await pool.query<{
      sourcePostId: number | null;
      position: number;
      title: string;
      videoUrl: string;
      learningState: unknown;
    }>(
      `
        SELECT source_post_id AS "sourcePostId",
               position,
               title_snapshot AS title,
               video_url_snapshot AS "videoUrl",
               owner_learning_state AS "learningState"
        FROM course_steps
        WHERE course_id = $1
      `,
      [courseId],
    );

    expect(step.rows[0]).toEqual({
      sourcePostId: null,
      position: 1,
      title: 'Source post',
      videoUrl: 'https://video.example/source',
      learningState: { marks: [{ at: 12, note: 'keep' }] },
    });
  });
});

async function insertUser(
  pool: Pool,
  ownerIds: number[],
  suffix: string,
): Promise<number> {
  const email = `${suffix}-${randomUUID()}@example.test`;
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash, password_algorithm,
        password_parameters, password_version, identity_assurance
      )
      VALUES (
        'Course owner', $1, $1, repeat('a', 64), 'legacy_sha256',
        '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
        1, 'legacy_grandfathered'
      )
      RETURNING id
    `,
    [email],
  );
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error('Expected a user ID');
  }

  ownerIds.push(id);
  return id;
}

async function insertCourse(
  pool: Pool,
  ownerId: number,
  title: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO courses (owner_id, title, description)
      VALUES ($1, $2, '')
      RETURNING id
    `,
    [ownerId, title],
  );
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error('Expected a Course ID');
  }

  return id;
}

async function insertSnapshotStep(
  client: Pick<PoolClient, 'query'> | Pool,
  courseId: number,
  position: number,
  title: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO course_steps (
        course_id, position, title_snapshot, video_url_snapshot,
        thumbnail_url_snapshot, channel_name_snapshot
      )
      VALUES ($1, $2, $3, $4, '', '')
    `,
    [courseId, position, title, `https://video.example/${position}`],
  );
}
