import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { COURSE_CUTOVER_ADVISORY_LOCK_KEY } from './course-cutover.policy';
import {
  CourseError,
  CourseFeedbackRateLimitedError,
  CourseIdempotencyConflictError,
  CourseLifecycleError,
  CourseNotFoundError,
  CoursePersistenceUnavailableError,
  CourseValidationError,
  CourseVersionConflictError,
} from './course.errors';
import type {
  CourseMutationCommand,
  CoursePageSlice,
  CourseRepository,
  CreateCourseCommand,
} from './course.repository';
import type {
  CourseAggregate,
  CourseCursor,
  CourseFeedback,
  CourseStep,
  CourseStepInput,
  OwnerLearningState,
  PublicCourseFeedbackProjection,
  PublicCourseProjection,
} from './course.types';

type SqlClient = Pool | PoolClient;

type OwnerCourseRow = {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  visibility: CourseAggregate['visibility'];
  status: CourseAggregate['status'];
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedAt: Date | string | null;
  archivedAt: Date | string | null;
  steps: CourseStep[];
  feedback: CourseFeedback[];
  cursorTimestamp: string;
};

type PublicCourseRow = Omit<
  PublicCourseProjection,
  'createdAt' | 'updatedAt' | 'publishedAt'
> & {
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedAt: Date | string;
  cursorTimestamp: string;
};

type CursorStamped<T> = {
  item: T;
  timestamp: string;
  id: number;
};

type LockedCourse = {
  ownerId: number;
  status: CourseAggregate['status'];
  version: number;
};

const DEFAULT_LEARNING_STATE: OwnerLearningState = {
  captionLanguage: 'ko',
  captionsEnabled: true,
  playbackRate: 1,
  loop: { enabled: false, manual: false, start: 0, end: 15 },
  marks: [],
};

export class PostgresCourseRepository implements CourseRepository {
  constructor(private readonly pool: Pool) {}

  async create(command: CreateCourseCommand): Promise<CourseAggregate> {
    return this.mutate(async (client) => {
      const inserted = await client.query<{ id: number }>(
        `
          INSERT INTO courses (
            owner_id, title, description,
            idempotency_key_digest, idempotency_payload_hash
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (owner_id, idempotency_key_digest) DO NOTHING
          RETURNING id
        `,
        [
          command.ownerId,
          command.course.title,
          command.course.description,
          command.idempotencyKeyDigest,
          command.payloadHash,
        ],
      );

      let courseId = inserted.rows[0]?.id;
      if (courseId === undefined) {
        const existing = await client.query<{
          id: number;
          payloadHash: Buffer;
        }>(
          `
            SELECT id, idempotency_payload_hash AS "payloadHash"
            FROM courses
            WHERE owner_id = $1 AND idempotency_key_digest = $2
            FOR UPDATE
          `,
          [command.ownerId, command.idempotencyKeyDigest],
        );
        const row = existing.rows[0];
        if (!row) {
          throw new CoursePersistenceUnavailableError();
        }
        if (
          !Buffer.isBuffer(row.payloadHash) ||
          !row.payloadHash.equals(command.payloadHash)
        ) {
          throw new CourseIdempotencyConflictError();
        }
        courseId = row.id;
      } else {
        for (const [index, step] of command.course.steps.entries()) {
          await this.insertStep(client, courseId, index + 1, step);
        }
        await this.enqueueCourseStepRetrieval(
          client,
          command.ownerId,
          courseId,
          1,
        );
      }

      return this.requireOwner(client, command.ownerId, courseId);
    });
  }

  async listOwner(
    ownerId: number,
    cursor: CourseCursor | null,
    limit: number,
  ): Promise<CoursePageSlice<CourseAggregate>> {
    const result = await this.queryOwner(
      this.pool,
      `c.owner_id = $1
       AND c.status <> 'archived'
       AND ($2::timestamptz IS NULL OR (c.created_at, c.id) < ($2, $3))`,
      [ownerId, cursor?.timestamp ?? null, cursor?.id ?? null, limit + 1],
      'ORDER BY c.created_at DESC, c.id DESC LIMIT $4',
    );
    return page(result, limit);
  }

  async findOwner(
    ownerId: number,
    courseId: number,
  ): Promise<CourseAggregate | null> {
    const rows = await this.queryOwner(
      this.pool,
      'c.owner_id = $1 AND c.id = $2',
      [ownerId, courseId],
    );
    return rows[0]?.item ?? null;
  }

  async listPublic(
    cursor: CourseCursor | null,
    limit: number,
  ): Promise<CoursePageSlice<PublicCourseProjection>> {
    const result = await this.queryPublic(
      `c.status = 'published'
       AND c.visibility = 'public'
       AND ($1::timestamptz IS NULL OR (c.published_at, c.id) < ($1, $2))`,
      [cursor?.timestamp ?? null, cursor?.id ?? null, limit + 1],
      'ORDER BY c.published_at DESC, c.id DESC LIMIT $3',
    );
    return page(result, limit);
  }

  async findPublic(courseId: number): Promise<PublicCourseProjection | null> {
    const rows = await this.queryPublic(
      `c.id = $1 AND c.status = 'published' AND c.visibility = 'public'`,
      [courseId],
    );
    return rows[0]?.item ?? null;
  }

  async updateMetadata(
    command: CourseMutationCommand & { title?: string; description?: string },
  ): Promise<CourseAggregate> {
    return this.mutate(async (client) => {
      const result = await client.query<{ id: number; version: number }>(
        `
          UPDATE courses
          SET title = COALESCE($4, title),
              description = COALESCE($5, description),
              version = version + 1,
              updated_at = statement_timestamp()
          WHERE id = $1
            AND owner_id = $2
            AND version = $3
            AND status <> 'archived'
          RETURNING id, version
        `,
        [
          command.courseId,
          command.ownerId,
          command.expectedVersion,
          command.title ?? null,
          command.description ?? null,
        ],
      );
      if (!result.rows[0]) {
        await this.throwMutationMismatch(client, command);
      }
      await this.enqueueCourseStepRetrieval(
        client,
        command.ownerId,
        command.courseId,
        result.rows[0].version,
      );
      return this.requireOwner(client, command.ownerId, command.courseId);
    });
  }

  async replaceSteps(
    command: CourseMutationCommand & { steps: CourseStepInput[] },
  ): Promise<CourseAggregate> {
    return this.mutate(async (client) => {
      const root = await this.lockOwnedCourse(client, command);
      if (root.status === 'published' && command.steps.length === 0) {
        throw new CourseLifecycleError('A published Course cannot be empty');
      }

      const existing = await client.query<{
        id: string;
        sourcePostId: number | null;
        title: string;
        videoUrl: string;
        thumbnailUrl: string;
        channelName: string;
        ownerLearningState: OwnerLearningState;
      }>(
        `
          SELECT id::text AS id,
                 source_post_id AS "sourcePostId",
                 title_snapshot AS title,
                 video_url_snapshot AS "videoUrl",
                 thumbnail_url_snapshot AS "thumbnailUrl",
                 channel_name_snapshot AS "channelName",
                 owner_learning_state AS "ownerLearningState"
          FROM course_steps
          WHERE course_id = $1
          FOR UPDATE
        `,
        [command.courseId],
      );
      const byId = new Map(existing.rows.map((row) => [row.id, row]));
      const retainedIds: string[] = [];

      for (const step of command.steps) {
        if (step.stepId !== undefined) {
          if (!byId.has(step.stepId)) {
            throw new CourseValidationError(
              'steps',
              'an existing step does not belong to this Course',
            );
          }
          retainedIds.push(step.stepId);
        }
      }
      const deletedIds = existing.rows
        .filter(({ id }) => !retainedIds.includes(id))
        .map(({ id }) => id);

      if (retainedIds.length === 0) {
        await client.query('DELETE FROM course_steps WHERE course_id = $1', [
          command.courseId,
        ]);
      } else {
        await client.query(
          `
            DELETE FROM course_steps
            WHERE course_id = $1 AND NOT (id = ANY($2::bigint[]))
          `,
          [command.courseId, retainedIds],
        );
      }

      for (const [index, step] of command.steps.entries()) {
        if (step.stepId !== undefined) {
          await client.query(
            'UPDATE course_steps SET position = $2 WHERE course_id = $1 AND id = $3::bigint',
            [command.courseId, index + 1, step.stepId],
          );
        } else {
          await this.insertStep(client, command.courseId, index + 1, step);
        }
      }

      const updated = await client.query<{ version: number }>(
        `
          UPDATE courses
          SET version = version + 1, updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING version
        `,
        [command.courseId],
      );
      await this.enqueueCourseStepRetrieval(
        client,
        command.ownerId,
        command.courseId,
        updated.rows[0].version,
        deletedIds,
      );
      return this.requireOwner(client, command.ownerId, command.courseId);
    });
  }

  async publish(command: CourseMutationCommand): Promise<CourseAggregate> {
    return this.transition(command, 'publish');
  }

  async archive(command: CourseMutationCommand): Promise<CourseAggregate> {
    return this.transition(command, 'archive');
  }

  async addFeedback(command: {
    authorId: number;
    courseId: number;
    rating: number;
    body: string;
  }): Promise<PublicCourseFeedbackProjection> {
    return this.mutate(async (client) => {
      await this.assertFeedbackRate(client, command, false);
      const root = await client.query<{ status: CourseAggregate['status'] }>(
        'SELECT status FROM courses WHERE id = $1 FOR UPDATE',
        [command.courseId],
      );
      if (!root.rows[0]) {
        throw new CourseNotFoundError();
      }
      if (root.rows[0].status !== 'published') {
        throw new CourseLifecycleError('Feedback requires a published Course');
      }
      await this.assertFeedbackRate(client, command, true);

      const inserted = await client.query<{
        id: number;
        authorName: string;
        rating: number;
        body: string;
        createdAt: Date | string;
      }>(
        `
          WITH created AS (
            INSERT INTO course_feedback (course_id, author_id, rating, body)
            VALUES ($1, $2, $3, $4)
            RETURNING id, author_id, rating, body, created_at
          )
          SELECT created.id,
                 users.name AS "authorName",
                 created.rating,
                 created.body,
                 created.created_at AS "createdAt"
          FROM created
          JOIN users ON users.id = created.author_id
        `,
        [command.courseId, command.authorId, command.rating, command.body],
      );
      const feedback = inserted.rows[0];
      if (!feedback) {
        throw new CoursePersistenceUnavailableError();
      }
      return { ...feedback, createdAt: iso(feedback.createdAt) };
    });
  }

  private async transition(
    command: CourseMutationCommand,
    action: 'publish' | 'archive',
  ): Promise<CourseAggregate> {
    return this.mutate(async (client) => {
      const root = await this.lockOwnedCourse(client, command);
      let courseVersion: number;
      if (action === 'publish') {
        if (root.status !== 'draft') {
          throw new CourseLifecycleError(
            'Only a draft Course can be published',
          );
        }
        const count = await client.query<{ count: number }>(
          'SELECT count(*)::integer AS count FROM course_steps WHERE course_id = $1',
          [command.courseId],
        );
        if ((count.rows[0]?.count ?? 0) === 0) {
          throw new CourseLifecycleError(
            'A Course must contain a step before publishing',
          );
        }
        const updated = await client.query<{ version: number }>(
          `
            UPDATE courses
            SET status = 'published', visibility = 'public',
                version = version + 1,
                published_at = statement_timestamp(),
                updated_at = statement_timestamp()
            WHERE id = $1
            RETURNING version
          `,
          [command.courseId],
        );
        courseVersion = updated.rows[0].version;
      } else {
        if (root.status === 'archived') {
          throw new CourseLifecycleError('An archived Course is immutable');
        }
        const updated = await client.query<{ version: number }>(
          `
            UPDATE courses
            SET status = 'archived', visibility = 'private',
                version = version + 1,
                archived_at = statement_timestamp(),
                updated_at = statement_timestamp()
            WHERE id = $1
            RETURNING version
          `,
          [command.courseId],
        );
        courseVersion = updated.rows[0].version;
      }
      await this.enqueueCourseStepRetrieval(
        client,
        command.ownerId,
        command.courseId,
        courseVersion,
      );
      return this.requireOwner(client, command.ownerId, command.courseId);
    });
  }

  private async lockOwnedCourse(
    client: PoolClient,
    command: CourseMutationCommand,
  ): Promise<LockedCourse> {
    const result = await client.query<LockedCourse>(
      `
        SELECT owner_id AS "ownerId", status, version
        FROM courses WHERE id = $1 FOR UPDATE
      `,
      [command.courseId],
    );
    const row = result.rows[0];
    if (!row || row.ownerId !== command.ownerId) {
      throw new CourseNotFoundError();
    }
    if (row.status === 'archived') {
      throw new CourseLifecycleError('An archived Course is immutable');
    }
    if (row.version !== command.expectedVersion) {
      throw new CourseVersionConflictError(
        command.expectedVersion,
        row.version,
      );
    }
    return row;
  }

  private async throwMutationMismatch(
    client: PoolClient,
    command: CourseMutationCommand,
  ): Promise<never> {
    const result = await client.query<LockedCourse>(
      `SELECT owner_id AS "ownerId", status, version FROM courses WHERE id = $1`,
      [command.courseId],
    );
    const row = result.rows[0];
    if (!row || row.ownerId !== command.ownerId) {
      throw new CourseNotFoundError();
    }
    if (row.status === 'archived') {
      throw new CourseLifecycleError('An archived Course is immutable');
    }
    throw new CourseVersionConflictError(command.expectedVersion, row.version);
  }

  private async assertFeedbackRate(
    client: PoolClient,
    command: { authorId: number; courseId: number },
    afterRootLock: boolean,
  ): Promise<void> {
    const rate = await client.query<{
      count: number;
      retryAfterSeconds: number;
    }>(
      `
        SELECT count(*)::integer AS count,
               GREATEST(
                 1,
                 CEIL(EXTRACT(EPOCH FROM (
                   min(created_at) + interval '10 minutes' - statement_timestamp()
                 )))::integer
               ) AS "retryAfterSeconds"
        FROM course_feedback
        WHERE author_id = $1
          AND course_id = $2
          AND created_at > statement_timestamp() - interval '10 minutes'
      `,
      [command.authorId, command.courseId],
    );
    const row = rate.rows[0];
    if ((row?.count ?? 0) >= 5) {
      throw new CourseFeedbackRateLimitedError(row?.retryAfterSeconds ?? 600);
    }
    void afterRootLock;
  }

  private async insertStep(
    client: PoolClient,
    courseId: number,
    position: number,
    input: Exclude<CourseStepInput, { stepId: string }>,
  ): Promise<void> {
    let sourcePostId: number | null = null;
    let snapshot: {
      title: string;
      videoUrl: string;
      thumbnailUrl: string;
      channelName: string;
    };
    if ('sourcePostId' in input) {
      const post = await client.query<{
        id: number;
        title: string;
        videoUrl: string;
        thumbnailUrl: string;
        channelName: string;
      }>(
        `
          SELECT id, title, video_url AS "videoUrl",
                 thumbnail_url AS "thumbnailUrl", channel_name AS "channelName"
          FROM posts WHERE id = $1
        `,
        [input.sourcePostId],
      );
      const row = post.rows[0];
      if (!row) {
        throw new CourseValidationError(
          'steps',
          'a referenced source post does not exist',
        );
      }
      sourcePostId = row.id;
      snapshot = row;
    } else {
      snapshot = input.snapshot;
    }
    const learningState = input.ownerLearningState ?? DEFAULT_LEARNING_STATE;
    await client.query(
      `
        INSERT INTO course_steps (
          course_id, source_post_id, position,
          title_snapshot, video_url_snapshot,
          thumbnail_url_snapshot, channel_name_snapshot,
          owner_learning_state
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        courseId,
        sourcePostId,
        position,
        snapshot.title,
        snapshot.videoUrl,
        snapshot.thumbnailUrl,
        snapshot.channelName,
        JSON.stringify(learningState),
      ],
    );
  }

  private async enqueueCourseStepRetrieval(
    client: PoolClient,
    ownerId: number,
    courseId: number,
    courseVersion: number,
    deletedStepIds: string[] = [],
  ): Promise<void> {
    const steps = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM course_steps
        WHERE course_id = $1
        ORDER BY id
      `,
      [courseId],
    );
    for (const step of steps.rows) {
      await this.enqueueCourseStepRetrievalEvent(
        client,
        ownerId,
        courseId,
        courseVersion,
        step.id,
        true,
      );
    }
    for (const stepId of deletedStepIds) {
      await this.enqueueCourseStepRetrievalEvent(
        client,
        ownerId,
        courseId,
        courseVersion,
        stepId,
        false,
      );
    }
  }

  private async enqueueCourseStepRetrievalEvent(
    client: PoolClient,
    ownerId: number,
    courseId: number,
    courseVersion: number,
    courseStepId: string,
    includeSourceVersion: boolean,
  ): Promise<void> {
    const payload = {
      sourceKind: 'course_step',
      sourceId: courseStepId,
      courseStepId,
      ...(includeSourceVersion ? { sourceVersion: String(courseVersion) } : {}),
      courseId,
    };
    await client.query(
      `
        INSERT INTO work_outbox_events (
          id, owner_id, event_type, aggregate_type, aggregate_id,
          aggregate_version, payload_schema_version, payload, trace_context
        )
        VALUES (
          $1, $2, 'retrieval_embedding.requested', 'course_step', $3,
          $4, 1, $5::jsonb, '{}'::jsonb
        )
      `,
      [
        randomUUID(),
        ownerId,
        courseStepId,
        courseVersion,
        JSON.stringify(payload),
      ],
    );
  }

  private async requireOwner(
    client: PoolClient,
    ownerId: number,
    courseId: number,
  ): Promise<CourseAggregate> {
    const rows = await this.queryOwner(
      client,
      'c.owner_id = $1 AND c.id = $2',
      [ownerId, courseId],
    );
    const course = rows[0];
    if (!course) {
      throw new CourseNotFoundError();
    }
    return course.item;
  }

  private async queryOwner(
    client: SqlClient,
    where: string,
    values: unknown[],
    suffix = '',
  ): Promise<Array<CursorStamped<CourseAggregate>>> {
    try {
      const result = await client.query<OwnerCourseRow>(
        `
        SELECT c.id, c.owner_id AS "ownerId", c.title, c.description,
               c.visibility, c.status, c.version,
               c.created_at AS "createdAt", c.updated_at AS "updatedAt",
               c.published_at AS "publishedAt", c.archived_at AS "archivedAt",
               to_char(
                 c.created_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) AS "cursorTimestamp",
               COALESCE(steps.value, '[]'::jsonb) AS steps,
               COALESCE(feedback.value, '[]'::jsonb) AS feedback
        FROM courses c
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cs.id::text,
              'courseId', cs.course_id,
              'sourcePostId', cs.source_post_id,
              'position', cs.position,
              'snapshot', jsonb_build_object(
                'title', cs.title_snapshot,
                'videoUrl', cs.video_url_snapshot,
                'thumbnailUrl', cs.thumbnail_url_snapshot,
                'channelName', cs.channel_name_snapshot
              ),
              'ownerLearningState', cs.owner_learning_state
            ) ORDER BY cs.position, cs.id
          ) AS value
          FROM course_steps cs WHERE cs.course_id = c.id
        ) steps ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cf.id,
              'courseId', cf.course_id,
              'authorId', cf.author_id,
              'authorName', u.name,
              'rating', cf.rating,
              'body', cf.body,
              'createdAt', cf.created_at
            ) ORDER BY cf.created_at DESC, cf.id DESC
          ) AS value
          FROM course_feedback cf
          JOIN users u ON u.id = cf.author_id
          WHERE cf.course_id = c.id
        ) feedback ON true
        WHERE ${where}
        ${suffix}
      `,
        values,
      );
      return result.rows.map((row) => ({
        item: hydrateOwner(row),
        timestamp: row.cursorTimestamp,
        id: row.id,
      }));
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  private async queryPublic(
    where: string,
    values: unknown[],
    suffix = '',
  ): Promise<Array<CursorStamped<PublicCourseProjection>>> {
    try {
      const result = await this.pool.query<PublicCourseRow>(
        `
        SELECT c.id, c.title, c.description, c.visibility, c.status, c.version,
               c.created_at AS "createdAt", c.updated_at AS "updatedAt",
               c.published_at AS "publishedAt",
               to_char(
                 c.published_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) AS "cursorTimestamp",
               COALESCE(steps.value, '[]'::jsonb) AS steps,
               COALESCE(feedback.value, '[]'::jsonb) AS feedback
        FROM courses c
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cs.id::text,
              'position', cs.position,
              'snapshot', jsonb_build_object(
                'title', cs.title_snapshot,
                'videoUrl', cs.video_url_snapshot,
                'thumbnailUrl', cs.thumbnail_url_snapshot,
                'channelName', cs.channel_name_snapshot
              )
            ) ORDER BY cs.position, cs.id
          ) AS value
          FROM course_steps cs WHERE cs.course_id = c.id
        ) steps ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cf.id,
              'authorName', u.name,
              'rating', cf.rating,
              'body', cf.body,
              'createdAt', cf.created_at
            ) ORDER BY cf.created_at DESC, cf.id DESC
          ) AS value
          FROM course_feedback cf
          JOIN users u ON u.id = cf.author_id
          WHERE cf.course_id = c.id
        ) feedback ON true
        WHERE ${where}
        ${suffix}
      `,
        values,
      );
      return result.rows.map((row) => ({
        item: hydratePublic(row),
        timestamp: row.cursorTimestamp,
        id: row.id,
      }));
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  private async mutate<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new CoursePersistenceUnavailableError({ cause: error });
    }
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query('SELECT pg_advisory_xact_lock_shared($1)', [
        COURSE_CUTOVER_ADVISORY_LOCK_KEY,
      ]);
      const result = await work(client);
      await client.query('COMMIT');
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw translatePostgresError(error);
    } finally {
      client.release();
    }
  }
}

function hydrateOwner(row: OwnerCourseRow): CourseAggregate {
  const { cursorTimestamp, ...course } = row;
  void cursorTimestamp;
  return {
    ...course,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    steps: row.steps ?? [],
    feedback: (row.feedback ?? []).map((item) => ({
      ...item,
      createdAt: iso(item.createdAt),
    })),
  };
}

function hydratePublic(row: PublicCourseRow): PublicCourseProjection {
  const { cursorTimestamp, ...course } = row;
  void cursorTimestamp;
  return {
    ...course,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    publishedAt: iso(row.publishedAt),
    feedback: (row.feedback ?? []).map((item) => ({
      ...item,
      createdAt: iso(item.createdAt),
    })),
  };
}

function page<T>(
  records: Array<CursorStamped<T>>,
  limit: number,
): CoursePageSlice<T> {
  const visible = records.slice(0, limit);
  const last = visible.at(-1);
  const hasMore = records.length > limit;
  return {
    items: visible.map(({ item }) => item),
    hasMore,
    nextCursor:
      hasMore && last ? { timestamp: last.timestamp, id: last.id } : null,
  };
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function translatePostgresError(error: unknown): unknown {
  if (error instanceof CourseError) {
    return error;
  }
  const code = postgresField(error, 'code');
  const constraint = postgresField(error, 'constraint');
  if (code === '23514' && constraint === 'courses_published_nonempty') {
    return new CourseLifecycleError('A published Course cannot be empty');
  }
  if (code === '23514' && constraint === 'course_steps_positions_contiguous') {
    return new CourseValidationError(
      'steps',
      'Course step positions must be contiguous',
    );
  }
  if (code === '23503') {
    return new CourseValidationError(
      'steps',
      'a referenced Course resource does not exist',
    );
  }
  if (code === '40001' || code === '40P01') {
    return new CourseVersionConflictError(0);
  }
  if (
    code?.startsWith('08') ||
    code === '57P01' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND'
  ) {
    return new CoursePersistenceUnavailableError({ cause: error });
  }
  return error;
}

function postgresField(error: unknown, field: string): string | undefined {
  if (!error || typeof error !== 'object' || !(field in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}
