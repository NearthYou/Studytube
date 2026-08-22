import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  RETRIEVAL_CANDIDATE_LIMIT,
  RETRIEVAL_LEXICAL_MIN_SIMILARITY,
  RETRIEVAL_RRF_K,
  RETRIEVAL_VECTOR_MAX_DISTANCE,
} from './retrieval.constants';
import {
  PostgresRetrievalRepository,
  RetrievalSourceInvariantError,
} from './postgres-retrieval.repository';

const VECTOR = Array(1536).fill(0.01) as number[];

describe('PostgresRetrievalRepository', () => {
  it('captures the profile goal, owner context, watched range, and caption generation once per Agent run', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          agentRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ownerId: 7,
          studyContextId: '81',
          learningItemId: '71',
          videoSourceId: '61',
          courseId: 4,
          profileGoal: '데이터베이스 강의를 이해한다',
          watchedRanges: [{ start: 20, end: 80 }],
          captionArtifactId: '51',
          captionGeneration: 3,
          contextRetrievalVersion: '5',
        },
      ],
    });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    await expect(
      repository.captureLearningContext({
        agentRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ownerId: 7,
        studyContextId: '81',
        watchedRanges: [{ start: 20, end: 80 }],
      }),
    ).resolves.toMatchObject({
      profileGoal: '데이터베이스 강의를 이해한다',
      captionGeneration: 3,
      contextRetrievalVersion: '5',
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM agent_runs AS run');
    expect(sql).toContain("state.status = 'ready'");
    expect(sql).toContain('ON CONFLICT (agent_run_id) DO NOTHING');
    expect(sql).toContain('snapshot.watched_ranges = $4::jsonb');
    expect(values).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      7,
      '81',
      JSON.stringify([{ start: 20, end: 80 }]),
    ]);
  });

  it('reads post, tags, source version, and latest asset in one SQL snapshot', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          sourceId: '42',
          sourceVersion: '7',
          ownerId: 9,
          visibility: 'public',
          title: 'Serializable transactions',
          summary: 'Isolation levels',
          translatedNotes: '재시도',
          tags: ['postgresql', 'transactions'],
          sourceUrl: 'https://youtu.be/source',
          transcriptBody: 'Transcript',
          sourceSegments: [{ start: 10, end: 20, text: 'Source' }],
          translatedSegments: [{ start: 10, end: 20, text: '번역' }],
        },
      ],
    });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    await expect(
      repository.readSourceSnapshot({ sourceKind: 'post', sourceId: 42 }),
    ).resolves.toMatchObject({
      sourceId: '42',
      sourceVersion: '7',
      tags: ['postgresql', 'transactions'],
      translatedSegments: [{ start: 10, end: 20, text: '번역' }],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('post.retrieval_version');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('FROM video_assets');
    expect(sql).toContain('FROM post_tags');
  });

  it('deletes at most the requested cache batch older than the retention cutoff', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    const query = jest.fn().mockResolvedValue({ rows: [{ removed: 2 }] });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    try {
      await expect(
        repository.pruneEmbeddingCache({ retentionDays: 90, batchSize: 2 }),
      ).resolves.toBe(2);

      const [sql, values] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('last_used_at < $1');
      expect(sql).toContain('ORDER BY last_used_at, model, content_hash');
      expect(sql).toContain('LIMIT $2');
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(values).toEqual([new Date('2026-04-30T00:00:00.000Z'), 2]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('enforces a recent-data floor and a small maximum cache batch', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    try {
      await repository.pruneEmbeddingCache({
        retentionDays: 1,
        batchSize: 50_000,
      });

      const [, values] = query.mock.calls[0] as [string, unknown[]];
      expect(values).toEqual([new Date('2026-06-29T00:00:00.000Z'), 500]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns superseded before writes when a stale source writer reaches the lock', async () => {
    const client = transactionalClient((sql) => {
      if (sql.includes('FROM posts')) {
        return {
          rows: [{ sourceVersion: '8', ownerId: 9, visibility: 'public' }],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresRetrievalRepository({
      connect: () => Promise.resolve(client),
    } as unknown as Pool);

    await expect(
      repository.replaceSourceChunks(replacement({ sourceVersion: '7' })),
    ).resolves.toBe('superseded');

    const statements = client.query.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    expect(statements).not.toContain(
      expect.stringContaining('INSERT INTO retrieval_embeddings'),
    );
    expect(statements).toContain('COMMIT');
  });

  it('removes every embedding model for a missing source under the source lock', async () => {
    const client = transactionalClient(() => ({ rows: [] }));
    const repository = new PostgresRetrievalRepository({
      connect: () => Promise.resolve(client),
    } as unknown as Pool);

    await expect(
      repository.removeMissingSourceChunks({
        sourceKind: 'course_step',
        sourceId: '9000000001',
      }),
    ).resolves.toBe('removed');

    const statements = client.query.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    expect(statements).toEqual(
      expect.arrayContaining([
        'BEGIN',
        expect.stringContaining('pg_advisory_xact_lock'),
        expect.stringContaining('DELETE FROM retrieval_embeddings'),
        'COMMIT',
      ]),
    );
    const deleteCall = client.query.mock.calls.find((call) =>
      String((call as unknown[])[0]).includes(
        'DELETE FROM retrieval_embeddings',
      ),
    ) as unknown[] | undefined;
    const lockCall = client.query.mock.calls.find((call) =>
      String((call as unknown[])[0]).includes('pg_advisory_xact_lock'),
    ) as unknown[] | undefined;
    expect(lockCall?.[1]).toEqual(['course_step:9000000001']);
    expect(deleteCall?.[0]).not.toEqual(expect.stringContaining('model ='));
    expect(deleteCall?.[1]).toEqual(['course_step', '9000000001']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not remove chunks when an active source appears before cleanup gets the lock', async () => {
    const client = transactionalClient((sql) => {
      if (sql.includes('FROM posts')) {
        return {
          rows: [{ sourceVersion: '11', ownerId: 9, visibility: 'public' }],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresRetrievalRepository({
      connect: () => Promise.resolve(client),
    } as unknown as Pool);

    await expect(
      repository.removeMissingSourceChunks({
        sourceKind: 'post',
        sourceId: '42',
      }),
    ).resolves.toBe('superseded');

    const statements = client.query.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    const lockIndex = statements.findIndex((sql) =>
      sql.includes('pg_advisory_xact_lock'),
    );
    const sourceIndex = statements.findIndex((sql) =>
      sql.includes('FROM posts'),
    );
    const lockCall = client.query.mock.calls[lockIndex] as unknown[];
    expect(lockCall[1]).toEqual(['post:42']);
    expect(lockIndex).toBeGreaterThan(statements.indexOf('BEGIN'));
    expect(sourceIndex).toBeGreaterThan(lockIndex);
    expect(statements).not.toContain(
      expect.stringContaining('DELETE FROM retrieval_embeddings'),
    );
    expect(statements.indexOf('COMMIT')).toBeGreaterThan(sourceIndex);
  });

  it('rejects non-canonical cleanup targets before opening a connection', async () => {
    const connect = jest.fn();
    const repository = new PostgresRetrievalRepository({
      connect,
    } as unknown as Pool);

    await expect(
      repository.removeMissingSourceChunks({
        sourceKind: 'post',
        sourceId: '01',
      }),
    ).rejects.toThrow('positive integer');
    await expect(
      repository.removeMissingSourceChunks({
        sourceKind: 'video' as never,
        sourceId: '42',
      }),
    ).rejects.toThrow('source kind');
    await expect(
      repository.removeMissingSourceChunks({
        sourceKind: 'post',
        sourceId: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).rejects.toThrow('safe integer');
    expect(connect).not.toHaveBeenCalled();
  });

  it('rolls back and releases the connection when cleanup fails after locking', async () => {
    const client = transactionalClient((sql) => {
      if (sql.includes('DELETE FROM retrieval_embeddings')) {
        throw new Error('delete failed');
      }
      return { rows: [] };
    });
    const repository = new PostgresRetrievalRepository({
      connect: () => Promise.resolve(client),
    } as unknown as Pool);

    await expect(
      repository.removeMissingSourceChunks({
        sourceKind: 'post',
        sourceId: '42',
      }),
    ).rejects.toThrow('delete failed');

    const statements = client.query.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    const lockIndex = statements.findIndex((sql) =>
      sql.includes('pg_advisory_xact_lock'),
    );
    const deleteIndex = statements.findIndex((sql) =>
      sql.includes('DELETE FROM retrieval_embeddings'),
    );
    expect(lockIndex).toBeGreaterThan(statements.indexOf('BEGIN'));
    expect(deleteIndex).toBeGreaterThan(lockIndex);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects a different content set for the same source version', async () => {
    const client = transactionalClient((sql) => {
      if (sql.includes('FROM posts')) {
        return {
          rows: [{ sourceVersion: '7', ownerId: 9, visibility: 'public' }],
        };
      }
      if (sql.includes('FROM retrieval_embeddings')) {
        return {
          rows: [
            {
              chunkIndex: 0,
              startSeconds: 10,
              endSeconds: 20,
              sourceVersion: '7',
              contentHash: createHash('sha256').update('other').digest(),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresRetrievalRepository({
      connect: () => Promise.resolve(client),
    } as unknown as Pool);

    await expect(
      repository.replaceSourceChunks(replacement()),
    ).rejects.toBeInstanceOf(RetrievalSourceInvariantError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('applies source authorization inside every candidate and returns a finite chunk citation score', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          sourceKind: 'course_step',
          sourceId: '91',
          visibility: 'private',
          title: 'Private transaction lesson',
          sourceUrl: 'https://youtu.be/private?t=30s',
          timestampSeconds: 30,
          content: 'Serializable transactions and retry loops',
          rankingScore: 0.0325,
        },
        {
          sourceKind: 'post',
          sourceId: '42',
          visibility: 'public',
          title: 'Public PostgreSQL lesson',
          sourceUrl: 'https://youtu.be/public?t=10s',
          timestampSeconds: 10,
          content: 'PostgreSQL isolation levels',
          rankingScore: '0.03',
        },
      ],
    });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    const result = await repository.hybridSearch({
      ownerId: 7,
      query: 'PostgreSQL transaction isolation',
      model: 'text-embedding-3-small',
      embedding: VECTOR,
      limit: 3,
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('authorized AS');
    expect(sql.match(/retrieval\.owner_id = \$1/gu)?.length).toBe(4);
    expect(sql).toContain('post.retrieval_version = retrieval.source_version');
    expect(sql).toContain('course.version = retrieval.source_version');
    expect(sql).toContain("course.status = 'draft'");
    expect(sql).toContain("course.status = 'published'");
    expect(sql).toContain('retrieval.content % $2');
    expect(sql).toContain('ORDER BY retrieval.embedding <=> $4::vector ASC');
    expect(sql).not.toContain(
      'ORDER BY retrieval.embedding <=> $4::vector ASC, retrieval.id',
    );
    expect(sql).toContain(
      "ORDER BY CASE visibility WHEN 'private' THEN 0 ELSE 1 END,\n               ranking_score DESC,\n               id",
    );
    expect(sql).toContain('PARTITION BY source_kind, source_id');
    expect(values).toEqual([
      7,
      'PostgreSQL transaction isolation',
      'text-embedding-3-small',
      expect.stringMatching(/^\[/u),
      3,
      RETRIEVAL_CANDIDATE_LIMIT,
      RETRIEVAL_LEXICAL_MIN_SIMILARITY,
      RETRIEVAL_VECTOR_MAX_DISTANCE,
      RETRIEVAL_RRF_K,
    ]);
    expect(result[0]).toMatchObject({
      sourceKind: 'course_step',
      sourceId: '91',
      score: 0.0325,
      citation: {
        sourceUrl: 'https://youtu.be/private?t=30s',
        timestampSeconds: 30,
      },
    });
    expect(result.every((hit) => Number.isFinite(hit.score))).toBe(true);
  });

  it('does not calculate vector distance in lexical-only mode', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    await repository.search(searchInput(), 'lexical');

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('lexical_private_pool');
    expect(sql).not.toContain('vector_private_pool');
    expect(sql).not.toContain('<=>');
    expect(values).toEqual([
      7,
      '격리 수준과 재시도',
      'text-embedding-3-small',
      3,
      RETRIEVAL_CANDIDATE_LIMIT,
      RETRIEVAL_LEXICAL_MIN_SIMILARITY,
    ]);
  });

  it('does not calculate trigram similarity in vector-only mode', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    await repository.search(searchInput(), 'vector');

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('vector_private_pool');
    expect(sql).not.toContain('lexical_private_pool');
    expect(sql).not.toContain('similarity(');
    expect(sql).not.toContain(' % ');
    expect(values).toEqual([
      7,
      'text-embedding-3-small',
      expect.stringMatching(/^\[/u),
      3,
      RETRIEVAL_CANDIDATE_LIMIT,
      RETRIEVAL_VECTOR_MAX_DISTANCE,
    ]);
  });

  it('limits learning evidence to the frozen owner context, item, watched range, and caption generation', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          sourceKind: 'learning_context',
          sourceId: '81',
          visibility: 'private',
          title: '현재 학습 영상',
          sourceUrl: 'https://youtu.be/caption0001?t=30s',
          timestampSeconds: 30,
          endSeconds: 42,
          content: '현재 문맥의 근거',
          rankingScore: 0.91,
          resourceId: 'caption-segment:701',
          readiness: 'ready',
          artifactGeneration: 4,
        },
      ],
    });
    const repository = new PostgresRetrievalRepository({
      query,
    } as unknown as Pool);

    const result = await repository.search(
      {
        ...searchInput(),
        contextSnapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'lexical',
    );

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('learning_retrieval_context_snapshots');
    expect(sql).toContain('snapshot.owner_id = $1');
    expect(sql).toContain('snapshot.study_context_id = retrieval.source_id');
    expect(sql).toContain(
      'snapshot.learning_item_id = context.learning_item_id',
    );
    expect(sql).toContain(
      'snapshot.caption_artifact_id = retrieval.evidence_artifact_id',
    );
    expect(sql).toContain(
      'snapshot.caption_generation = retrieval.artifact_generation',
    );
    expect(sql).toContain('jsonb_array_elements(snapshot.watched_ranges)');
    expect(values).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result).toEqual([
      expect.objectContaining({
        resourceId: 'caption-segment:701',
        readiness: 'ready',
        artifactGeneration: 4,
        citation: {
          sourceUrl: 'https://youtu.be/caption0001?t=30s',
          timestampSeconds: 30,
          endSeconds: 42,
        },
      }),
    ]);
  });

  it('rejects a non-finite database score', async () => {
    const repository = new PostgresRetrievalRepository({
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            sourceKind: 'post',
            sourceId: '42',
            visibility: 'public',
            title: 'Bad score',
            sourceUrl: 'https://example.test',
            timestampSeconds: null,
            content: 'Content',
            rankingScore: 'NaN',
          },
        ],
      }),
    } as unknown as Pool);

    await expect(repository.search(searchInput(), 'lexical')).rejects.toThrow(
      'non-finite score',
    );
  });
});

function replacement(overrides: { sourceVersion?: string } = {}) {
  return {
    sourceKind: 'post' as const,
    sourceId: '42',
    sourceVersion: overrides.sourceVersion ?? '7',
    ownerId: 9,
    visibility: 'public' as const,
    model: 'text-embedding-3-small',
    chunks: [
      {
        chunkIndex: 0,
        content: 'Serializable transaction lesson',
        startSeconds: 10,
        endSeconds: 20,
        sourceUrl: 'https://youtu.be/source?t=10s',
        embedding: VECTOR,
      },
    ],
  };
}

function searchInput() {
  return {
    ownerId: 7,
    query: '격리 수준과 재시도',
    model: 'text-embedding-3-small',
    embedding: VECTOR,
    limit: 3,
  };
}

function transactionalClient(
  result: (sql: string) => { rows: unknown[] },
): TransactionalClient {
  const query = jest.fn((sql: string) => Promise.resolve(result(sql)));
  return {
    query,
    release: jest.fn(),
  } as unknown as TransactionalClient;
}

type TransactionalClient = Omit<PoolClient, 'query' | 'release'> & {
  query: jest.Mock;
  release: jest.Mock;
};
