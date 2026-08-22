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

describe('Next-learning proposal approval (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let pool: Pool;
  const userIds: number[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  it('keeps reads immutable and applies one verified proposal exactly once to an existing Course', async () => {
    const owner = await createIdentity(pool, 'Proposal Owner');
    const outsider = await createIdentity(pool, 'Proposal Outsider');
    userIds.push(owner.userId, outsider.userId);
    const courseId = await createCourse(pool, owner.userId, '기존 Course');
    const runId = await seedVerifiedRun(pool, owner.userId, '다음 학습');

    const proposal = (
      await request(app.getHttpServer())
        .post(`/learning/agent-runs/${runId}/next-learning-proposal`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', owner.cookie)
        .send({})
        .expect(201)
    ).body as ProposalResponse;
    expect(proposal).toMatchObject({
      state: 'pending',
      approvedCourseId: null,
    });
    await request(app.getHttpServer())
      .get(`/learning/proposals/${proposal.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/learning/proposals/${proposal.id}`)
      .set('Cookie', outsider.cookie)
      .expect(404);
    expect(await courseFacts(pool, courseId)).toMatchObject({
      version: 1,
      steps: 0,
    });

    const approval = {
      proposalId: proposal.id,
      targetKind: 'existing_course',
      courseId,
      expectedCourseVersion: 1,
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/learning/proposals/approve')
          .set('Origin', WEB_ORIGIN)
          .set('Cookie', owner.cookie)
          .send(approval),
      ),
    );
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(responses[0].body).toMatchObject({
      state: 'approved',
      approvedCourseId: courseId,
      approvedCourseVersion: 2,
    });
    expect(await courseFacts(pool, courseId)).toMatchObject({
      version: 2,
      steps: 1,
      retrievalEvents: 1,
      contexts: 1,
    });

    await request(app.getHttpServer())
      .post('/learning/proposals/approve')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .send({ ...approval, videoUrl: 'https://example.test/tampered' })
      .expect(400);
    expect((await courseFacts(pool, courseId)).steps).toBe(1);
  });

  it('leaves the Course unchanged for version conflict, dismissal, expiry and payload tampering', async () => {
    const owner = await createIdentity(pool, 'Conflict Owner');
    userIds.push(owner.userId);
    const courseId = await createCourse(pool, owner.userId, '충돌 Course');

    const conflict = await createProposal(app, pool, owner, '충돌 후보');
    await pool.query('UPDATE courses SET version = 2 WHERE id = $1', [
      courseId,
    ]);
    await approveExisting(app, owner.cookie, conflict.id, courseId, 1).expect(
      409,
    );
    expect((await courseFacts(pool, courseId)).steps).toBe(0);

    const dismissed = await createProposal(app, pool, owner, '거절 후보');
    await request(app.getHttpServer())
      .post(`/learning/proposals/${dismissed.id}/dismiss`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ state: 'dismissed' }));
    await approveExisting(app, owner.cookie, dismissed.id, courseId, 2).expect(
      409,
    );
    expect((await courseFacts(pool, courseId)).steps).toBe(0);

    const expired = await createProposal(app, pool, owner, '만료 후보');
    await pool.query(
      `UPDATE learning_proposals
       SET created_at = statement_timestamp() - interval '2 days',
           expires_at = statement_timestamp() - interval '1 day'
       WHERE id = $1`,
      [expired.id],
    );
    await approveExisting(app, owner.cookie, expired.id, courseId, 2).expect(
      409,
    );
    expect((await courseFacts(pool, courseId)).steps).toBe(0);

    const tampered = await createProposal(app, pool, owner, '변조 후보');
    await pool.query(
      `UPDATE learning_proposals
       SET payload = jsonb_set(payload, '{candidate,title}', '"변조됨"'::jsonb)
       WHERE id = $1`,
      [tampered.id],
    );
    await approveExisting(app, owner.cookie, tampered.id, courseId, 2).expect(
      409,
    );
    expect((await courseFacts(pool, courseId)).steps).toBe(0);
  });

  it('creates one private Course and its first occurrence in the approval transaction', async () => {
    const owner = await createIdentity(pool, 'First Course Owner');
    userIds.push(owner.userId);
    const proposal = await createProposal(app, pool, owner, '첫 Course 후보');

    const approved = (
      await request(app.getHttpServer())
        .post('/learning/proposals/approve')
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', owner.cookie)
        .send({
          proposalId: proposal.id,
          targetKind: 'new_private_course',
          title: '나의 외국어 학습',
        })
        .expect(200)
    ).body as ProposalResponse;
    expect(approved).toMatchObject({
      state: 'approved',
      approvedCourseVersion: 1,
    });
    const course = await pool.query<{
      title: string;
      visibility: string;
      status: string;
      steps: number;
    }>(
      `SELECT c.title, c.visibility, c.status, count(cs.id)::integer AS steps
       FROM courses c LEFT JOIN course_steps cs ON cs.course_id = c.id
       WHERE c.id = $1 GROUP BY c.id`,
      [approved.approvedCourseId],
    );
    expect(course.rows[0]).toEqual({
      title: '나의 외국어 학습',
      visibility: 'private',
      status: 'draft',
      steps: 1,
    });
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

async function createProposal(
  app: INestApplication<App>,
  pool: Pool,
  owner: { userId: number; cookie: string },
  objective: string,
) {
  const runId = await seedVerifiedRun(pool, owner.userId, objective);
  return (
    await request(app.getHttpServer())
      .post(`/learning/agent-runs/${runId}/next-learning-proposal`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', owner.cookie)
      .send({})
      .expect(201)
  ).body as ProposalResponse;
}

function approveExisting(
  app: INestApplication<App>,
  cookie: string,
  proposalId: string,
  courseId: number,
  expectedCourseVersion: number,
) {
  return request(app.getHttpServer())
    .post('/learning/proposals/approve')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', cookie)
    .send({
      proposalId,
      targetKind: 'existing_course',
      courseId,
      expectedCourseVersion,
    });
}

async function seedVerifiedRun(pool: Pool, ownerId: number, objective: string) {
  const runId = randomUUID();
  const attemptId = randomUUID();
  const post = await pool.query<{ id: number }>(
    `INSERT INTO posts (
       author_id, title, video_url, thumbnail_url,
       channel_name, summary, translated_notes
     ) VALUES ($1, $2, 'https://www.youtube.com/watch?v=abcdefghijk', '',
               'Study Channel', '', '') RETURNING id`,
    [ownerId, objective],
  );
  const candidate = {
    position: 1,
    title: objective,
    videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    thumbnailUrl: '',
    channelName: 'Study Channel',
    sourcePostId: post.rows[0].id,
    evidenceSourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    evidenceTimestampSeconds: 10,
    evidenceConfidence: 0.91,
    status: 'ready',
    durationSeconds: 300,
  };
  await pool.query(
    `INSERT INTO agent_runs (
       id, owner_id, state, version, input,
       wall_time_budget_ms, tool_call_budget, token_budget,
       estimated_cost_budget_usd
     ) VALUES ($1, $2, 'awaiting_approval', 2, $3::jsonb,
               180000, 12, 24000, 0.5)`,
    [runId, ownerId, JSON.stringify({ objective, requestedStepCount: 1 })],
  );
  await pool.query(
    `INSERT INTO agent_run_attempts (
       id, run_id, attempt_number, state, started_at, finished_at
     ) VALUES ($1, $2, 1, 'completed', statement_timestamp(), statement_timestamp())`,
    [attemptId, runId],
  );
  await pool.query(
    `INSERT INTO agent_run_work_items (
       id, run_id, attempt_id, kind, position, status,
       payload_schema_version, payload, completed_at
     ) VALUES ($1, $2, $3, 'proposed_step', 1, 'completed', 1,
               $4::jsonb, statement_timestamp())`,
    [randomUUID(), runId, attemptId, JSON.stringify(candidate)],
  );
  await pool.query(
    `INSERT INTO agent_tool_calls (
       id, run_id, attempt_id, request_id, tool_name,
       input_schema_version, output_schema_version, duration_ms,
       outcome, source, input, output
     ) VALUES ($1, $2, $3, $4, 'propose_next_learning',
               1, 1, 10, 'succeeded', 'mcp-loopback-http',
               '{}'::jsonb, '{"proposalVersion":1}'::jsonb)`,
    [randomUUID(), runId, attemptId, randomUUID()],
  );
  return runId;
}

async function createCourse(pool: Pool, ownerId: number, title: string) {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO courses (owner_id, title, description)
     VALUES ($1, $2, '') RETURNING id`,
    [ownerId, title],
  );
  return result.rows[0].id;
}

async function courseFacts(pool: Pool, courseId: number) {
  const result = await pool.query<{
    version: number;
    steps: number;
    retrievalEvents: number;
    contexts: number;
  }>(
    `SELECT c.version,
            count(DISTINCT cs.id)::integer AS steps,
            count(DISTINCT event.id)::integer AS "retrievalEvents",
            count(DISTINCT context.id)::integer AS contexts
     FROM courses c
     LEFT JOIN course_steps cs ON cs.course_id = c.id
     LEFT JOIN work_outbox_events event
       ON event.aggregate_type = 'course_step'
      AND event.aggregate_id = cs.id::text
      AND event.event_type = 'retrieval_embedding.requested'
     LEFT JOIN study_contexts context ON context.course_step_id = cs.id
     WHERE c.id = $1 GROUP BY c.id`,
    [courseId],
  );
  return result.rows[0];
}

async function createIdentity(pool: Pool, name: string) {
  const suffix = randomUUID();
  const email = `proposal-${suffix}@example.test`;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (
       name, email, email_canonical, password_hash, password_algorithm,
       password_parameters, password_version, identity_assurance
     ) VALUES ($1, $2, $2, $3, 'legacy_sha256',
               '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
               1, 'legacy_grandfathered') RETURNING id`,
    [name, email, '0'.repeat(64)],
  );
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (
       id, token_digest, user_id, created_at,
       absolute_expires_at, idle_expires_at, last_seen_at
     ) VALUES ($1, $2, $3, now(), now() + interval '7 days',
               now() + interval '1 day', now())`,
    [
      randomUUID(),
      createHash('sha256').update(token).digest(),
      user.rows[0].id,
    ],
  );
  return { userId: user.rows[0].id, cookie: `studytube_session=${token}` };
}

type ProposalResponse = {
  id: string;
  state: string;
  approvedCourseId: number | null;
  approvedCourseVersion: number | null;
};
