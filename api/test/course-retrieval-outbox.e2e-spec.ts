import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { CourseVersionConflictError } from '../src/course/course.errors';
import { PostgresCourseRepository } from '../src/course/postgres-course.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

type RetrievalOutboxRow = {
  id: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
  traceContext: Record<string, unknown>;
};

describe('Course retrieval outbox lifecycle (e2e)', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let repository: PostgresCourseRepository;
  const userIds: number[] = [];
  const courseStepIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repository = new PostgresCourseRepository(pool);
  });

  it('indexes every step exactly once when an idempotent draft is created', async () => {
    const ownerId = await insertUser(pool, 'Course Index Owner');
    userIds.push(ownerId);
    const idempotencyKeyDigest = createHash('sha256')
      .update(randomUUID())
      .digest();
    const payloadHash = createHash('sha256').update('course payload').digest();
    const command = {
      ownerId,
      idempotencyKeyDigest,
      payloadHash,
      course: {
        title: 'Indexed Draft',
        description: 'Every draft step remains searchable by its owner',
        steps: [snapshotStep('One'), snapshotStep('Two')],
      },
    };

    const created = await repository.create(command);
    courseStepIds.push(...created.steps.map(({ id }) => id));
    await repository.create(command);

    const events = await readRetrievalEvents(
      pool,
      created.steps.map(({ id }) => id),
    );
    expect(events).toHaveLength(2);
    expect(events.map(({ aggregateId }) => aggregateId).sort()).toEqual(
      created.steps.map(({ id }) => id).sort(),
    );
    for (const event of events) {
      expect(event.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      );
      expect(event.aggregateVersion).toBe(1);
      expect(event.payload).toEqual({
        sourceKind: 'course_step',
        sourceId: event.aggregateId,
        courseStepId: event.aggregateId,
        sourceVersion: '1',
        courseId: created.id,
      });
      expect(event.traceContext).toEqual({});
    }
    expect(new Set(events.map(({ id }) => id)).size).toBe(2);
  });

  it('reindexes every current step at the new metadata version', async () => {
    const ownerId = await insertUser(pool, 'Course Metadata Owner');
    userIds.push(ownerId);
    const created = await repository.create({
      ownerId,
      idempotencyKeyDigest: createHash('sha256').update(randomUUID()).digest(),
      payloadHash: createHash('sha256').update('metadata payload').digest(),
      course: {
        title: 'Metadata Draft',
        description: '',
        steps: [snapshotStep('Metadata One'), snapshotStep('Metadata Two')],
      },
    });
    const stepIds = created.steps.map(({ id }) => id);
    courseStepIds.push(...stepIds);

    const updated = await repository.updateMetadata({
      ownerId,
      courseId: created.id,
      expectedVersion: created.version,
      title: 'Metadata Draft Updated',
    });

    expect(updated.version).toBe(2);
    const versionTwo = (await readRetrievalEvents(pool, stepIds)).filter(
      ({ aggregateVersion }) => aggregateVersion === 2,
    );
    expect(versionTwo).toHaveLength(2);
    for (const event of versionTwo) {
      expect(event.payload).toMatchObject({
        sourceKind: 'course_step',
        sourceId: event.aggregateId,
        courseStepId: event.aggregateId,
        sourceVersion: '2',
        courseId: created.id,
      });
    }
  });

  it('reindexes retained and inserted steps while requesting cleanup for deleted steps', async () => {
    const ownerId = await insertUser(pool, 'Course Steps Owner');
    userIds.push(ownerId);
    const created = await repository.create({
      ownerId,
      idempotencyKeyDigest: createHash('sha256').update(randomUUID()).digest(),
      payloadHash: createHash('sha256').update('replace payload').digest(),
      course: {
        title: 'Replace Steps Draft',
        description: '',
        steps: [
          snapshotStep('Delete One'),
          snapshotStep('Retain'),
          snapshotStep('Delete Two'),
        ],
      },
    });
    const originalIds = created.steps.map(({ id }) => id);
    courseStepIds.push(...originalIds);

    const replaced = await repository.replaceSteps({
      ownerId,
      courseId: created.id,
      expectedVersion: created.version,
      steps: [{ stepId: originalIds[1] }, snapshotStep('Inserted')],
    });
    const currentIds = replaced.steps.map(({ id }) => id);
    const insertedId = currentIds.find((id) => !originalIds.includes(id));
    expect(insertedId).toBeDefined();
    if (!insertedId) throw new Error('Expected an inserted Course step');
    courseStepIds.push(insertedId);

    const versionTwo = (
      await readRetrievalEvents(pool, [...originalIds, insertedId])
    ).filter(({ aggregateVersion }) => aggregateVersion === 2);
    const currentEvents = versionTwo.filter(({ payload }) =>
      Object.hasOwn(payload, 'sourceVersion'),
    );
    expect(currentEvents.map(({ aggregateId }) => aggregateId).sort()).toEqual(
      currentIds.sort(),
    );
    for (const event of currentEvents) {
      expect(event.payload).toMatchObject({
        sourceKind: 'course_step',
        sourceId: event.aggregateId,
        courseStepId: event.aggregateId,
        sourceVersion: '2',
        courseId: created.id,
      });
    }

    const cleanupEvents = versionTwo.filter(
      ({ payload }) => !Object.hasOwn(payload, 'sourceVersion'),
    );
    expect(cleanupEvents.map(({ aggregateId }) => aggregateId).sort()).toEqual(
      [originalIds[0], originalIds[2]].sort(),
    );
    for (const event of cleanupEvents) {
      expect(event.payload).toEqual({
        sourceKind: 'course_step',
        sourceId: event.aggregateId,
        courseStepId: event.aggregateId,
        courseId: created.id,
      });
      expect(event.traceContext).toEqual({});
    }
  });

  it('reindexes every step when publishing and again when archiving', async () => {
    const ownerId = await insertUser(pool, 'Course Transition Owner');
    userIds.push(ownerId);
    const created = await repository.create({
      ownerId,
      idempotencyKeyDigest: createHash('sha256').update(randomUUID()).digest(),
      payloadHash: createHash('sha256').update('transition payload').digest(),
      course: {
        title: 'Transition Draft',
        description: '',
        steps: [snapshotStep('Publish One'), snapshotStep('Publish Two')],
      },
    });
    const stepIds = created.steps.map(({ id }) => id);
    courseStepIds.push(...stepIds);

    const published = await repository.publish({
      ownerId,
      courseId: created.id,
      expectedVersion: created.version,
    });
    expect(published).toMatchObject({ status: 'published', version: 2 });
    expectVersionedEvents(
      (await readRetrievalEvents(pool, stepIds)).filter(
        ({ aggregateVersion }) => aggregateVersion === 2,
      ),
      stepIds,
      created.id,
      2,
    );

    const archived = await repository.archive({
      ownerId,
      courseId: created.id,
      expectedVersion: published.version,
    });
    expect(archived).toMatchObject({ status: 'archived', version: 3 });
    expectVersionedEvents(
      (await readRetrievalEvents(pool, stepIds)).filter(
        ({ aggregateVersion }) => aggregateVersion === 3,
      ),
      stepIds,
      created.id,
      3,
    );
  });

  it('does not emit an event when an optimistic mutation loses', async () => {
    const ownerId = await insertUser(pool, 'Course Conflict Owner');
    userIds.push(ownerId);
    const created = await repository.create({
      ownerId,
      idempotencyKeyDigest: createHash('sha256').update(randomUUID()).digest(),
      payloadHash: createHash('sha256').update('conflict payload').digest(),
      course: {
        title: 'Conflict Draft',
        description: '',
        steps: [snapshotStep('Conflict')],
      },
    });
    const stepIds = created.steps.map(({ id }) => id);
    courseStepIds.push(...stepIds);

    await expect(
      repository.updateMetadata({
        ownerId,
        courseId: created.id,
        expectedVersion: created.version + 1,
        title: 'Must Not Persist',
      }),
    ).rejects.toBeInstanceOf(CourseVersionConflictError);

    const events = await readRetrievalEvents(pool, stepIds);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateVersion).toBe(1);
    expect(await repository.findOwner(ownerId, created.id)).toMatchObject({
      title: 'Conflict Draft',
      version: 1,
    });
  });

  afterAll(async () => {
    if (pool && courseStepIds.length > 0) {
      await pool.query(
        `DELETE FROM work_outbox_events
         WHERE aggregate_type = 'course_step'
           AND aggregate_id = ANY($1::text[])`,
        [courseStepIds],
      );
    }
    if (pool && userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    await pool?.end();
  });
});

function snapshotStep(label: string) {
  return {
    snapshot: {
      title: `Step ${label}`,
      videoUrl: `https://video.example.test/${label.toLowerCase()}`,
      thumbnailUrl: '',
      channelName: 'Index Lab',
    },
  };
}

async function insertUser(pool: Pool, name: string): Promise<number> {
  const email = `course-index-${randomUUID()}@example.test`;
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

async function readRetrievalEvents(
  pool: Pool,
  stepIds: string[],
): Promise<RetrievalOutboxRow[]> {
  const result = await pool.query<RetrievalOutboxRow>(
    `
      SELECT id::text,
             aggregate_id AS "aggregateId",
             aggregate_version AS "aggregateVersion",
             payload,
             trace_context AS "traceContext"
      FROM work_outbox_events
      WHERE event_type = 'retrieval_embedding.requested'
        AND aggregate_type = 'course_step'
        AND aggregate_id = ANY($1::text[])
      ORDER BY occurred_at, id
    `,
    [stepIds],
  );
  return result.rows;
}

function expectVersionedEvents(
  events: RetrievalOutboxRow[],
  stepIds: string[],
  courseId: number,
  sourceVersion: number,
): void {
  expect(events.map(({ aggregateId }) => aggregateId).sort()).toEqual(
    [...stepIds].sort(),
  );
  for (const event of events) {
    expect(event.payload).toEqual({
      sourceKind: 'course_step',
      sourceId: event.aggregateId,
      courseStepId: event.aggregateId,
      sourceVersion: String(sourceVersion),
      courseId,
    });
    expect(event.traceContext).toEqual({});
  }
}
