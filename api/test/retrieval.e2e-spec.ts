import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresRetrievalRepository } from '../src/retrieval/postgres-retrieval.repository';
import { RetrievalEmbeddingJobHandler } from '../src/retrieval/retrieval-embedding.worker';
import { DurableJobExecutor } from '../src/work/durable-job.executor';
import { MemoryJobExecutionStore } from '../src/work/memory-job-execution.store';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@127.0.0.1:5432/app_dev';
const MODEL = 'text-embedding-3-small';
const VECTOR = [1, ...Array.from({ length: 1535 }, () => 0)];
const ORTHOGONAL_VECTOR = [0, 1, ...Array.from({ length: 1534 }, () => 0)];

describe('retrieval safety (e2e)', () => {
  jest.setTimeout(30_000);

  it('keeps private Course sources owner-scoped, deduplicates chunks, and cites the matched chunk', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    const runId = randomUUID();
    const ownerIds: number[] = [];

    try {
      const callerId = await createUser(pool, `caller-${runId}@example.test`);
      const otherId = await createUser(pool, `other-${runId}@example.test`);
      const publicOwnerId = await createUser(
        pool,
        `public-${runId}@example.test`,
      );
      ownerIds.push(callerId, otherId, publicOwnerId);
      const callerStepId = await createDraftCourseStep(pool, callerId);
      const otherStepId = await createDraftCourseStep(pool, otherId);
      const publicPostId = await createPost(
        pool,
        publicOwnerId,
        'Public supplemental source',
      );

      const callerSnapshot = await repository.readSourceSnapshot({
        sourceKind: 'course_step',
        sourceId: callerStepId,
      });
      const otherSnapshot = await repository.readSourceSnapshot({
        sourceKind: 'course_step',
        sourceId: otherStepId,
      });
      const postSnapshot = await repository.readSourceSnapshot({
        sourceKind: 'post',
        sourceId: publicPostId,
      });
      expect(callerSnapshot).toMatchObject({ visibility: 'private' });
      expect(otherSnapshot).toMatchObject({ visibility: 'private' });
      expect(postSnapshot).toMatchObject({ visibility: 'public' });
      if (!callerSnapshot || !otherSnapshot || !postSnapshot) {
        throw new Error('Retrieval fixture snapshot was not created');
      }

      await repository.replaceSourceChunks({
        ...sourceIdentity(callerSnapshot),
        model: MODEL,
        chunks: [
          retrievalChunk(0, 'unrelated introduction', 0, 10, ORTHOGONAL_VECTOR),
          retrievalChunk(
            1,
            'serializable transaction retry write skew',
            30,
            45,
          ),
        ],
      });
      await repository.replaceSourceChunks({
        ...sourceIdentity(otherSnapshot),
        model: MODEL,
        chunks: [
          retrievalChunk(
            0,
            'serializable transaction retry write skew',
            20,
            25,
          ),
        ],
      });
      await repository.replaceSourceChunks({
        ...sourceIdentity(postSnapshot),
        model: MODEL,
        chunks: [
          retrievalChunk(
            0,
            'serializable transaction retry write skew',
            15,
            20,
          ),
        ],
      });

      const hits = await repository.hybridSearch({
        ownerId: callerId,
        query: 'serializable transaction retry',
        model: MODEL,
        embedding: VECTOR,
        limit: 3,
      });

      expect(hits.map((hit) => `${hit.sourceKind}:${hit.sourceId}`)).toEqual([
        `course_step:${callerStepId}`,
        `post:${publicPostId}`,
      ]);
      expect(hits[0]).toMatchObject({
        visibility: 'private',
        citation: { timestampSeconds: 30 },
      });
      expect(hits[0]?.citation.sourceUrl).toContain('t=30s');
      expect(
        hits.some(
          (hit) =>
            hit.sourceKind === 'course_step' && hit.sourceId === otherStepId,
        ),
      ).toBe(false);
    } finally {
      if (ownerIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::integer[])', [
          ownerIds,
        ]);
      }
      await pool.end();
    }
  });

  it('makes a stale writer a no-op and cleans deleted source chunks', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    const runId = randomUUID();
    const userId = await createUser(pool, `stale-${runId}@example.test`);

    try {
      const postId = await createPost(pool, userId, 'Version one');
      const snapshot = await repository.readSourceSnapshot({
        sourceKind: 'post',
        sourceId: postId,
      });
      if (!snapshot) {
        throw new Error('Post snapshot was not created');
      }
      await pool.query('UPDATE posts SET title = $2 WHERE id = $1', [
        postId,
        'Version two',
      ]);

      await expect(
        repository.replaceSourceChunks({
          ...sourceIdentity(snapshot),
          model: MODEL,
          chunks: [retrievalChunk(0, 'stale content', 5, 10)],
        }),
      ).resolves.toBe('superseded');
      const staleCount = await pool.query<{ count: number }>(
        `
          SELECT count(*)::integer AS count
          FROM retrieval_embeddings
          WHERE source_kind = 'post' AND source_id = $1
        `,
        [postId],
      );
      expect(staleCount.rows[0]?.count).toBe(0);

      const tag = await pool.query<{ id: number }>(
        `INSERT INTO tags (name) VALUES ($1) RETURNING id`,
        [`trigger-${runId}`],
      );
      await pool.query(
        `INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)`,
        [postId, tag.rows[0].id],
      );
      await pool.query(
        `
          INSERT INTO video_assets (post_id, video_id, video_url)
          VALUES ($1, $2, 'https://youtu.be/retrieval')
        `,
        [postId, `video-${runId}`],
      );

      const current = await repository.readSourceSnapshot({
        sourceKind: 'post',
        sourceId: postId,
      });
      if (!current) {
        throw new Error('Current post snapshot was not found');
      }
      expect(BigInt(current.sourceVersion)).toBeGreaterThan(
        BigInt(snapshot.sourceVersion) + 1n,
      );
      await repository.replaceSourceChunks({
        ...sourceIdentity(current),
        model: MODEL,
        chunks: [retrievalChunk(0, 'current content', 5, 10)],
      });
      await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
      const deletedCount = await pool.query<{ count: number }>(
        `
          SELECT count(*)::integer AS count
          FROM retrieval_embeddings
          WHERE source_kind = 'post' AND source_id = $1
        `,
        [postId],
      );
      expect(deletedCount.rows[0]?.count).toBe(0);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });

  it('excludes an orphan row even before cleanup and deletes Course chunks with the step', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    const runId = randomUUID();
    const userId = await createUser(pool, `orphan-${runId}@example.test`);

    try {
      const stepId = await createDraftCourseStep(pool, userId);
      const snapshot = await repository.readSourceSnapshot({
        sourceKind: 'course_step',
        sourceId: stepId,
      });
      if (!snapshot) {
        throw new Error('Course step snapshot was not created');
      }
      await repository.replaceSourceChunks({
        ...sourceIdentity(snapshot),
        model: MODEL,
        chunks: [retrievalChunk(0, 'orphan guard phrase', 10, 20)],
      });
      const orphanSourceId = '9223372036854775000';
      await pool.query(
        `
          INSERT INTO retrieval_embeddings (
            source_kind, source_id, owner_id, visibility, model, content,
            content_hash, source_url, embedding, timestamp_seconds,
            chunk_index, start_seconds, end_seconds, source_version
          )
          VALUES (
            'post', $1::bigint, $2, 'public', $3, $4,
            $5, 'https://example.test/orphan', $6::vector,
            10, 0, 10, 20, 1
          )
        `,
        [
          orphanSourceId,
          userId,
          MODEL,
          'orphan guard phrase',
          sha256('orphan guard phrase'),
          vectorLiteral(),
        ],
      );

      const hits = await repository.hybridSearch({
        ownerId: userId,
        query: 'orphan guard phrase',
        model: MODEL,
        embedding: VECTOR,
        limit: 10,
      });
      expect(hits.some((hit) => hit.sourceId === orphanSourceId)).toBe(false);

      await pool.query('DELETE FROM course_steps WHERE id = $1::bigint', [
        stepId,
      ]);
      const count = await pool.query<{ count: number }>(
        `
          SELECT count(*)::integer AS count
          FROM retrieval_embeddings
          WHERE source_kind = 'course_step' AND source_id = $1::bigint
        `,
        [stepId],
      );
      expect(count.rows[0]?.count).toBe(0);
      await pool.query(
        `DELETE FROM retrieval_embeddings WHERE source_kind = 'post' AND source_id = $1::bigint`,
        [orphanSourceId],
      );
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });

  it('handles an archived Course event as idempotent all-model cleanup without touching another source', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    const runId = randomUUID();
    const userId = await createUser(pool, `archive-${runId}@example.test`);

    try {
      const archivedStepId = await createDraftCourseStep(pool, userId);
      const retainedStepId = await createDraftCourseStep(pool, userId);
      const archivedSnapshot = await repository.readSourceSnapshot({
        sourceKind: 'course_step',
        sourceId: archivedStepId,
      });
      const retainedSnapshot = await repository.readSourceSnapshot({
        sourceKind: 'course_step',
        sourceId: retainedStepId,
      });
      if (!archivedSnapshot || !retainedSnapshot) {
        throw new Error('Course step snapshots were not created');
      }

      await repository.replaceSourceChunks({
        ...sourceIdentity(archivedSnapshot),
        model: MODEL,
        chunks: [retrievalChunk(0, 'current model chunk', 10, 20)],
      });
      await repository.replaceSourceChunks({
        ...sourceIdentity(archivedSnapshot),
        model: 'text-embedding-3-small-previous',
        chunks: [retrievalChunk(0, 'previous model chunk', 20, 30)],
      });
      await repository.replaceSourceChunks({
        ...sourceIdentity(retainedSnapshot),
        model: MODEL,
        chunks: [retrievalChunk(0, 'retained source chunk', 30, 40)],
      });
      await pool.query(
        `
          UPDATE courses
          SET status = 'archived',
              visibility = 'private',
              archived_at = statement_timestamp(),
              updated_at = statement_timestamp()
          WHERE id = (
            SELECT course_id
            FROM course_steps
            WHERE id = $1::bigint
          )
        `,
        [archivedStepId],
      );
      await expect(
        repository.readSourceSnapshot({
          sourceKind: 'course_step',
          sourceId: archivedStepId,
        }),
      ).resolves.toBeNull();

      const executionStore = new MemoryJobExecutionStore();
      const cleanup = jest.spyOn(repository, 'removeMissingSourceChunks');
      const handler = new RetrievalEmbeddingJobHandler(
        {
          embedding: () => Promise.reject(new Error('must not embed')),
        },
        repository,
        new DurableJobExecutor(executionStore, {
          leaseOwner: 'retrieval-e2e',
          leaseMs: 30_000,
        }),
      );
      const job = {
        eventId: randomUUID(),
        eventType: 'retrieval_embedding.requested',
        handlerVersion: 'retrieval-embedding-v2',
        payloadSchemaVersion: 1,
        payload: {
          sourceKind: 'course_step',
          sourceId: archivedStepId,
          sourceVersion: archivedSnapshot.sourceVersion,
        },
      };

      await expect(handler.handle(job)).resolves.toMatchObject({
        sourceKind: 'course_step',
        sourceId: archivedStepId,
        indexingOutcome: 'removed',
        chunkCount: 0,
      });
      await expect(handler.handle(job)).resolves.toMatchObject({
        indexingOutcome: 'removed',
      });
      expect(cleanup).toHaveBeenCalledTimes(1);
      await expect(
        repository.removeMissingSourceChunks({
          sourceKind: 'course_step',
          sourceId: archivedStepId,
        }),
      ).resolves.toBe('removed');
      expect(cleanup).toHaveBeenCalledTimes(2);

      const counts = await pool.query<{
        sourceId: string;
        modelCount: number;
      }>(
        `
          SELECT source_id::text AS "sourceId",
                 count(DISTINCT model)::integer AS "modelCount"
          FROM retrieval_embeddings
          WHERE source_kind = 'course_step'
            AND source_id = ANY($1::bigint[])
          GROUP BY source_id
          ORDER BY source_id
        `,
        [[archivedStepId, retainedStepId]],
      );
      expect(counts.rows).toEqual([
        { sourceId: retainedStepId, modelCount: 1 },
      ]);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });

  it('single-flights concurrent embedding cache misses across connections', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    const repository = new PostgresRetrievalRepository(pool);
    const content = `cache probe ${randomUUID()}`;
    let providerCalls = 0;
    const load = async () => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        model: MODEL,
        dimensions: 1536 as const,
        embedding: VECTOR,
        inputTokens: 4,
        estimatedCostUsd: 0.000001,
      };
    };

    try {
      const [first, second] = await Promise.all([
        repository.resolveEmbedding({ model: MODEL, content }, load),
        repository.resolveEmbedding({ model: MODEL, content }, load),
      ]);
      expect(providerCalls).toBe(1);
      expect([first.cacheHit, second.cacheHit].filter(Boolean)).toHaveLength(1);
      expect(first.embedding).toHaveLength(1536);
      expect(second.embedding).toHaveLength(1536);
    } finally {
      await pool.query(
        `DELETE FROM retrieval_embedding_cache WHERE model = $1 AND content_hash = $2`,
        [MODEL, sha256(content)],
      );
      await pool.end();
    }
  });

  it('prunes only one old cache batch while retaining recent entries', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    const prefix = `retention probe ${randomUUID()}`;
    const contents = [
      `${prefix} old 1`,
      `${prefix} old 2`,
      `${prefix} old 3`,
      `${prefix} recent`,
    ];

    try {
      for (const content of contents) {
        await pool.query(
          `
            INSERT INTO retrieval_embedding_cache (
              model, content_hash, dimensions, embedding, last_used_at
            )
            VALUES ($1, $2, 1536, $3::vector, statement_timestamp())
          `,
          [MODEL, sha256(content), vectorLiteral()],
        );
      }
      await pool.query(
        `
          UPDATE retrieval_embedding_cache
          SET last_used_at = statement_timestamp() - interval '100 days'
          WHERE model = $1 AND content_hash = ANY($2::bytea[])
        `,
        [MODEL, contents.slice(0, 3).map(sha256)],
      );

      await expect(
        repository.pruneEmbeddingCache({ retentionDays: 90, batchSize: 2 }),
      ).resolves.toBe(2);

      const remaining = await pool.query<{
        age: 'old' | 'recent';
        count: number;
      }>(
        `
          SELECT CASE
                   WHEN last_used_at < statement_timestamp() - interval '90 days'
                     THEN 'old'
                   ELSE 'recent'
                 END AS age,
                 count(*)::integer AS count
          FROM retrieval_embedding_cache
          WHERE model = $1 AND content_hash = ANY($2::bytea[])
          GROUP BY age
          ORDER BY age
        `,
        [MODEL, contents.map(sha256)],
      );
      expect(remaining.rows).toEqual([
        { age: 'old', count: 1 },
        { age: 'recent', count: 1 },
      ]);
    } finally {
      await pool.query(
        `
          DELETE FROM retrieval_embedding_cache
          WHERE model = $1 AND content_hash = ANY($2::bytea[])
        `,
        [MODEL, contents.map(sha256)],
      );
      await pool.end();
    }
  });
});

function sourceIdentity(snapshot: {
  sourceKind: 'post' | 'course_step';
  sourceId: string;
  sourceVersion: string;
  ownerId: number;
  visibility: 'private' | 'public';
}) {
  return {
    sourceKind: snapshot.sourceKind,
    sourceId: snapshot.sourceId,
    sourceVersion: snapshot.sourceVersion,
    ownerId: snapshot.ownerId,
    visibility: snapshot.visibility,
  };
}

function retrievalChunk(
  chunkIndex: number,
  content: string,
  startSeconds: number,
  endSeconds: number,
  embedding: number[] = VECTOR,
) {
  return {
    chunkIndex,
    content,
    startSeconds,
    endSeconds,
    sourceUrl: `https://youtu.be/retrieval?t=${startSeconds}s`,
    embedding,
  };
}

function vectorLiteral(): string {
  return `[${VECTOR.join(',')}]`;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

async function createUser(pool: Pool, email: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name,
        email,
        email_canonical,
        password_hash,
        password_algorithm,
        password_parameters,
        password_version,
        identity_assurance
      )
      VALUES ($1, $2, $2, $3, 'legacy_sha256', $4, 1, 'legacy_grandfathered')
      RETURNING id
    `,
    [
      'Retrieval probe',
      email,
      'a'.repeat(64),
      { digest: 'sha256', encoding: 'lower_hex' },
    ],
  );
  return result.rows[0].id;
}

async function createPost(
  pool: Pool,
  authorId: number,
  title: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO posts (
        author_id,
        title,
        video_url,
        thumbnail_url,
        channel_name,
        summary,
        translated_notes
      )
      VALUES ($1, $2, 'https://youtu.be/retrieval', '', 'StudyTube', '', '')
      RETURNING id
    `,
    [authorId, title],
  );
  return result.rows[0].id;
}

async function createDraftCourseStep(
  pool: Pool,
  ownerId: number,
): Promise<string> {
  const course = await pool.query<{ id: number }>(
    `
      INSERT INTO courses (owner_id, title, description)
      VALUES ($1, 'Private retrieval Course', '')
      RETURNING id
    `,
    [ownerId],
  );
  const step = await pool.query<{ id: string }>(
    `
      INSERT INTO course_steps (
        course_id,
        position,
        title_snapshot,
        video_url_snapshot,
        evidence_source_url,
        evidence_timestamp_seconds,
        evidence_confidence,
        generation_status,
        duration_seconds
      )
      VALUES (
        $1,
        1,
        'Private transaction lesson',
        'https://youtu.be/private',
        'https://youtu.be/private',
        0,
        1,
        'ready',
        60
      )
      RETURNING id::text AS id
    `,
    [course.rows[0].id],
  );
  return step.rows[0].id;
}
