import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Pool, type PoolClient, type QueryConfig, type QueryResult } from 'pg';
import {
  assertQueryPlanContract,
  extractExplainPlan,
  QUERY_PLAN_VERIFICATION_SESSION_SETTINGS,
  type ExplainPlan,
  type QueryPlanContract,
} from '../src/database-query-plan';
import { PostgresGoogleAuthRepository } from '../src/auth/google/postgres-google-auth.repository';
import { PostgresCourseRepository } from '../src/course/postgres-course.repository';
import { PostgresRetrievalRepository } from '../src/retrieval/postgres-retrieval.repository';
import { PostgresWorkRepository } from '../src/work/postgres-work.repository';

type NamedPlan = {
  name: string;
  plan: ExplainPlan;
  contract: QueryPlanContract;
};

const VECTOR_DIMENSIONS = 1536;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for query plan verification');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const plans: NamedPlan[] = [];
  const outputPath = resolve(
    process.env.QUERY_PLAN_OUTPUT_PATH ?? '.ci-artifacts/query-plans.json',
  );
  try {
    await client.query('BEGIN');
    for (const setting of QUERY_PLAN_VERIFICATION_SESSION_SETTINGS) {
      await client.query(setting);
    }
    const fixture = await installFixture(client);

    plans.push({
      name: 'Google authorization attempt lookup',
      plan: await captureSinglePlan(client, async (explainingPool) => {
        await new PostgresGoogleAuthRepository(
          explainingPool,
        ).consumeGoogleAuthAttempt(fixture.googleAuthStateDigest, new Date());
      }),
      contract: {
        requiredIndexes: [/^google_auth_attempts_state_key$/u],
        forbiddenSequentialScanRelations: ['google_auth_attempts'],
      },
    });
    plans.push({
      name: 'course detail',
      plan: await captureSinglePlan(client, async (explainingPool) => {
        await new PostgresCourseRepository(explainingPool).findOwner(
          fixture.ownerId,
          fixture.courseId,
        );
      }),
      contract: {
        requiredIndexes: [
          /^courses_pkey$/u,
          /^course_steps_course_position_key$/u,
          /^course_feedback_course_created_at_idx$/u,
        ],
        forbiddenSequentialScanRelations: [
          'courses',
          'course_steps',
          'course_feedback',
        ],
      },
    });
    plans.push({
      name: 'outbox claim',
      plan: await captureSinglePlan(client, async (explainingPool) => {
        await new PostgresWorkRepository(explainingPool).claimOutboxBatch(
          25,
          'ci-query-plan',
          30_000,
        );
      }),
      contract: {
        requiredIndexes: [/^work_outbox_claim_idx$/u],
        forbiddenSequentialScanRelations: ['work_outbox_events'],
      },
    });
    plans.push({
      name: 'hybrid retrieval',
      plan: await captureSinglePlan(client, async (explainingPool) => {
        await new PostgresRetrievalRepository(explainingPool).hybridSearch({
          ownerId: fixture.ownerId,
          query: 'query plan learning',
          model: 'text-embedding-3-small',
          embedding: Array<number>(VECTOR_DIMENSIONS).fill(0.001),
          limit: 10,
        });
      }),
      contract: {
        requiredIndexes: [
          /^retrieval_embeddings_lexical_idx$/u,
          /^retrieval_embeddings_vector_idx$/u,
          /^retrieval_embeddings_visibility_owner_idx$/u,
          /^retrieval_embeddings_source_version_idx$/u,
        ],
        forbiddenSequentialScanRelations: ['retrieval_embeddings'],
      },
    });

    await persistPlans(outputPath, plans);
    for (const item of plans) {
      assertQueryPlanContract(item.name, item.plan, item.contract);
    }
    process.stdout.write(
      `Verified ${plans.length} PostgreSQL query plan contracts\n`,
    );
  } finally {
    if (plans.length > 0) {
      await persistPlans(outputPath, plans).catch(() => undefined);
    }
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function captureSinglePlan(
  client: PoolClient,
  run: (pool: Pool) => Promise<void>,
): Promise<ExplainPlan> {
  const captured: ExplainPlan[] = [];
  const explainingPool = {
    query: async (
      query: string | QueryConfig,
      suppliedValues?: unknown[],
    ): Promise<QueryResult> => {
      const text = typeof query === 'string' ? query : query.text;
      const values =
        typeof query === 'string' ? suppliedValues : (query.values ?? []);
      const explained = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`,
        values,
      );
      captured.push(extractExplainPlan(explained.rows[0]?.['QUERY PLAN']));
      return {
        command: 'EXPLAIN',
        rowCount: 0,
        oid: 0,
        rows: [],
        fields: [],
      };
    },
  } as unknown as Pool;
  await run(explainingPool);
  if (captured.length !== 1) {
    throw new Error(
      `Query count budget exceeded: expected 1 statement, captured ${captured.length}`,
    );
  }
  return captured[0];
}

async function installFixture(client: PoolClient): Promise<{
  ownerId: number;
  courseId: number;
  googleAuthStateDigest: Buffer;
}> {
  const emailCanonical = 'ci-query-plan-target@example.test';
  const googleAuthStateDigest = Buffer.alloc(32, 17);
  const owner = await client.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash,
        password_algorithm, password_parameters, password_version,
        identity_assurance, email_verified_at
      )
      VALUES (
        'CI query plan target', $1, $1, 'disabled:demo-seed-login',
        'disabled', '{"reason":"query_plan_fixture"}'::jsonb, 1,
        'email_verified', statement_timestamp()
      )
      RETURNING id
    `,
    [emailCanonical],
  );
  const ownerId = requireInteger(owner.rows[0]?.id, 'fixture owner');
  await client.query(
    `
      INSERT INTO google_auth_attempts (
        id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
        created_at, expires_at
      )
      VALUES (
        gen_random_uuid(), 'login', $1, decode(repeat('22', 32), 'hex'),
        decode('78', 'hex'), statement_timestamp(),
        statement_timestamp() + interval '10 minutes'
      )
    `,
    [googleAuthStateDigest],
  );
  await client.query(
    `
      INSERT INTO google_auth_attempts (
        id, purpose, state_digest, nonce_digest, encrypted_code_verifier,
        created_at, expires_at
      )
      SELECT gen_random_uuid(),
             'login',
             decode(md5(value::text) || md5('state-' || value::text), 'hex'),
             decode(md5('nonce-' || value::text) || md5('n-' || value::text), 'hex'),
             decode('78', 'hex'),
             statement_timestamp(),
             statement_timestamp() + interval '10 minutes'
      FROM generate_series(1, 1000) AS series(value)
    `,
  );
  await client.query(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash,
        password_algorithm, password_parameters, password_version,
        identity_assurance, email_verified_at
      )
      SELECT 'CI query plan user ' || value,
             'ci-query-plan-' || value || '@example.test',
             'ci-query-plan-' || value || '@example.test',
             'disabled:demo-seed-login',
             'disabled', '{"reason":"query_plan_fixture"}'::jsonb, 1,
             'email_verified', statement_timestamp()
      FROM generate_series(1, 300) AS value
    `,
  );
  const course = await client.query<{ id: number }>(
    `
      INSERT INTO courses (owner_id, title, description)
      VALUES ($1, 'CI query plan Course', 'Index regression fixture')
      RETURNING id
    `,
    [ownerId],
  );
  const courseId = requireInteger(course.rows[0]?.id, 'fixture Course');
  await client.query(
    `
      INSERT INTO courses (owner_id, title, description)
      SELECT $1, 'CI query plan filler Course ' || value, 'Plan selectivity fixture'
      FROM generate_series(1, 5000) AS value
    `,
    [ownerId],
  );
  await client.query(
    `
      INSERT INTO course_steps (
        course_id, position, title_snapshot, video_url_snapshot,
        thumbnail_url_snapshot, channel_name_snapshot
      )
      SELECT $1, value, 'Step ' || value,
             'https://video.example.test/watch/' || value,
             'https://image.example.test/' || value || '.jpg',
             'CI channel'
      FROM generate_series(1, 40) AS value
    `,
    [courseId],
  );
  await client.query(
    `
      INSERT INTO course_steps (
        course_id, position, title_snapshot, video_url_snapshot,
        thumbnail_url_snapshot, channel_name_snapshot
      )
      SELECT course.id, 1, 'Filler step',
             'https://video.example.test/filler/' || course.id,
             'https://image.example.test/filler/' || course.id || '.jpg',
             'CI channel'
      FROM courses AS course
      WHERE course.title LIKE 'CI query plan filler Course %'
    `,
  );
  await client.query(
    `
      INSERT INTO course_feedback (course_id, author_id, rating, body, created_at)
      SELECT course.id,
             users.id,
             4,
             'CI query plan filler feedback',
             statement_timestamp() - (course.id * interval '1 second')
      FROM courses AS course
      JOIN users ON users.id = $1 + ((course.id % 300) + 1)
      WHERE course.title LIKE 'CI query plan filler Course %'
    `,
    [ownerId],
  );
  await client.query(
    `
      INSERT INTO course_feedback (course_id, author_id, rating, body, created_at)
      SELECT $1, id, 5, 'CI query plan feedback',
             statement_timestamp() - (id * interval '1 second')
      FROM users
      WHERE email_canonical LIKE 'ci-query-plan-%@example.test'
      ORDER BY id
      LIMIT 200
    `,
    [courseId],
  );
  await client.query(
    `
      INSERT INTO work_outbox_events (
        id, event_type, aggregate_type, aggregate_id,
        aggregate_version, payload_schema_version, payload,
        occurred_at, available_at
      )
      SELECT gen_random_uuid(), 'query_plan.fixture', 'fixture', value::text,
             1, 1, '{}'::jsonb,
             statement_timestamp() - (value * interval '1 second'),
             statement_timestamp() - (value * interval '1 second')
      FROM generate_series(1, 20000) AS value
    `,
  );
  await client.query(
    `
      INSERT INTO posts (
        author_id, title, video_url, thumbnail_url, channel_name,
        summary, translated_notes
      )
      SELECT $1, 'CI query plan post ' || value,
             'https://video.example.test/post/' || value,
             'https://image.example.test/post/' || value || '.jpg',
             'CI channel',
             CASE WHEN value % 200 = 0
               THEN 'query plan learning retrieval content ' || value
               ELSE 'unrelated retrieval fixture content ' || value
             END,
             'retrieval fixture notes'
      FROM generate_series(1, 10000) AS value
    `,
    [ownerId],
  );
  const nearVector = `[${Array<string>(VECTOR_DIMENSIONS).fill('0.001').join(',')}]`;
  const farVector = `[${Array<string>(VECTOR_DIMENSIONS).fill('-0.001').join(',')}]`;
  await client.query(
    `
      INSERT INTO retrieval_embeddings (
        source_kind, source_id, owner_id, visibility, model, dimensions,
        content, content_hash, source_url, embedding,
        chunk_index, source_version
      )
      SELECT 'post', post.id, $1, 'public', 'text-embedding-3-small', 1536,
             post.summary, decode(repeat(md5(post.summary), 2), 'hex'),
             post.video_url,
             CASE WHEN post.summary LIKE 'query plan learning%'
               THEN $2::vector
               ELSE $3::vector
             END,
             0, post.retrieval_version
      FROM posts AS post
      WHERE post.author_id = $1
        AND post.title LIKE 'CI query plan post %'
    `,
    [ownerId, nearVector, farVector],
  );
  await client.query(
    'ANALYZE users, google_auth_attempts, courses, course_steps, course_feedback, work_outbox_events, posts, retrieval_embeddings',
  );
  return { ownerId, courseId, googleAuthStateDigest };
}

async function persistPlans(path: string, plans: NamedPlan[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      plans.map(({ name, plan }) => ({ name, plan })),
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function requireInteger(value: unknown, label: string): number {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 1) {
    throw new Error(`Failed to create ${label}`);
  }
  return integer;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Query plan verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
