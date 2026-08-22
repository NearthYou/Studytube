import { DurableJobExecutor } from '../work/durable-job.executor';
import { MemoryJobExecutionStore } from '../work/memory-job-execution.store';
import { WorkJobBusyError } from '../work/work.errors';
import type { WorkQueueJob } from '../work/work.queue';
import {
  buildRetrievalChunks,
  RETRIEVAL_CHUNK_MAX_CHARACTERS,
  RetrievalEmbeddingJobHandler,
} from './retrieval-embedding.worker';
import type { RetrievalSourceSnapshot } from './retrieval.types';

const VECTOR = Array(1536).fill(0.01) as number[];
const POST_SNAPSHOT: RetrievalSourceSnapshot = {
  sourceKind: 'post',
  sourceId: '42',
  sourceVersion: '3',
  ownerId: 7,
  visibility: 'public',
  title: 'PostgreSQL isolation',
  summary: 'Transactions and consistency',
  translatedNotes: 'Serializable retry patterns',
  tags: ['postgresql', 'transactions'],
  sourceUrl: 'https://youtu.be/isolation',
  transcriptBody: '',
  sourceSegments: [],
  translatedSegments: [
    { start: 12, end: 24, text: '가'.repeat(6500) },
    { start: 24, end: 36, text: '직렬화 격리와 재시도' },
  ],
};

const JOB: WorkQueueJob = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'retrieval_embedding.requested',
  handlerVersion: 'retrieval-embedding-v1',
  payloadSchemaVersion: 1,
  payload: { sourceKind: 'post', sourceId: '42', sourceVersion: '3' },
};

describe('RetrievalEmbeddingJobHandler', () => {
  it('runs one embedding provider call for concurrent delivery and replays the result', async () => {
    const execution = jobExecution();
    let finish:
      | ((response: {
          model: string;
          dimensions: number;
          embedding: number[];
        }) => void)
      | undefined;
    const embedding = jest.fn(
      () =>
        new Promise<{
          model: string;
          dimensions: number;
          embedding: number[];
        }>((resolve) => {
          finish = resolve;
        }),
    );
    const replaceSourceChunks = jest.fn().mockResolvedValue('stored');
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding },
      {
        readSourceSnapshot: () =>
          Promise.resolve({
            ...POST_SNAPSHOT,
            transcriptBody: 'One short retrieval chunk',
            translatedSegments: [],
          }),
        resolveEmbedding: (_input, load) => load(),
        replaceSourceChunks,
      },
      execution.executor,
    );

    const active = handler.handle(JOB);
    await expect(handler.handle(JOB)).rejects.toBeInstanceOf(WorkJobBusyError);
    finish?.({
      model: 'text-embedding-3-small',
      dimensions: 1536,
      embedding: VECTOR,
    });
    await expect(active).resolves.toMatchObject({
      indexingOutcome: 'stored',
      chunkCount: 1,
    });
    await expect(handler.handle(JOB)).resolves.toMatchObject({
      indexingOutcome: 'stored',
      chunkCount: 1,
    });

    expect(embedding).toHaveBeenCalledTimes(1);
    expect(replaceSourceChunks).toHaveBeenCalledTimes(1);
  });

  it('embeds every bounded timestamp chunk before replacing the whole source once', async () => {
    const execution = jobExecution();
    const replaceSourceChunks = jest.fn().mockResolvedValue('stored');
    const embedding = jest.fn().mockResolvedValue({
      model: 'text-embedding-3-small',
      dimensions: 1536,
      embedding: VECTOR,
      inputTokens: 100,
      estimatedCostUsd: 0.00001,
    });
    const resolveEmbedding = jest.fn(
      (_input: unknown, load: () => Promise<unknown>) => load(),
    );
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(POST_SNAPSHOT),
        resolveEmbedding,
        replaceSourceChunks,
      },
      execution.executor,
    );

    await expect(handler.handle(JOB)).resolves.toMatchObject({
      sourceKind: 'post',
      sourceId: '42',
      sourceVersion: '3',
      indexingOutcome: 'stored',
      chunkCount: 3,
    });
    await handler.handle(JOB);

    expect(embedding).toHaveBeenCalledTimes(3);
    expect(resolveEmbedding).toHaveBeenCalledTimes(3);
    expect(replaceSourceChunks).toHaveBeenCalledTimes(1);
    const calls = replaceSourceChunks.mock.calls as unknown as Array<
      [
        {
          chunks: Array<{
            content: string;
            startSeconds: number | null;
            endSeconds: number | null;
            sourceUrl: string;
          }>;
        },
      ]
    >;
    const replacement = calls[0][0];
    expect(replacement.chunks).toHaveLength(3);
    expect(
      replacement.chunks.every(
        (chunk) => chunk.content.length <= RETRIEVAL_CHUNK_MAX_CHARACTERS,
      ),
    ).toBe(true);
    expect(replacement.chunks[0]).toMatchObject({
      startSeconds: 12,
      endSeconds: 24,
    });
    expect(replacement.chunks[0]?.sourceUrl).toContain('t=12s');
  });

  it('processes a private course step against its current Course snapshot', async () => {
    const snapshot: RetrievalSourceSnapshot = {
      ...POST_SNAPSHOT,
      sourceKind: 'course_step',
      sourceId: '9000000001',
      sourceVersion: '12',
      visibility: 'private',
      transcriptBody: 'Private draft lesson',
      sourceSegments: [],
      translatedSegments: [],
    };
    const replaceSourceChunks = jest.fn().mockResolvedValue('stored');
    const execution = jobExecution();
    const handler = new RetrievalEmbeddingJobHandler(
      {
        embedding: () =>
          Promise.resolve({
            model: 'text-embedding-3-small',
            dimensions: 1536,
            embedding: VECTOR,
          }),
      },
      {
        readSourceSnapshot: jest.fn().mockResolvedValue(snapshot),
        resolveEmbedding: (_input, load) => load(),
        replaceSourceChunks,
      },
      execution.executor,
    );

    await handler.handle({
      ...JOB,
      payload: {
        sourceKind: 'course_step',
        sourceId: '9000000001',
        sourceVersion: '12',
      },
    });

    expect(replaceSourceChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'course_step',
        sourceId: '9000000001',
        sourceVersion: '12',
        visibility: 'private',
      }),
    );
  });

  it('marks an old delivery superseded without paying for embeddings', async () => {
    const embedding = jest.fn();
    const replaceSourceChunks = jest.fn();
    const execution = jobExecution();
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(POST_SNAPSHOT),
        resolveEmbedding: jest.fn(),
        replaceSourceChunks,
      },
      execution.executor,
    );

    await expect(
      handler.handle({
        ...JOB,
        payload: { sourceKind: 'post', sourceId: '42', sourceVersion: '2' },
      }),
    ).resolves.toMatchObject({
      indexingOutcome: 'superseded',
      chunkCount: 0,
    });
    expect(embedding).not.toHaveBeenCalled();
    expect(replaceSourceChunks).not.toHaveBeenCalled();
  });

  it('removes every model for a missing source and records a successful result', async () => {
    const execution = jobExecution();
    const removeMissingSourceChunks = jest.fn().mockResolvedValue('removed');
    const embedding = jest.fn();
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(null),
        resolveEmbedding: jest.fn(),
        replaceSourceChunks: jest.fn(),
        removeMissingSourceChunks,
      },
      execution.executor,
    );

    await expect(handler.handle(JOB)).resolves.toEqual({
      sourceKind: 'post',
      sourceId: '42',
      model: 'text-embedding-3-small',
      indexingOutcome: 'removed',
      chunkCount: 0,
    });
    await expect(handler.handle(JOB)).resolves.toEqual(
      expect.objectContaining({ indexingOutcome: 'removed' }),
    );

    expect(removeMissingSourceChunks).toHaveBeenCalledTimes(1);
    expect(removeMissingSourceChunks).toHaveBeenCalledWith({
      sourceKind: 'post',
      sourceId: '42',
    });
    expect(embedding).not.toHaveBeenCalled();
  });

  it('rejects a rounded numeric source ID before reading or deleting a source', async () => {
    const readSourceSnapshot = jest.fn();
    const removeMissingSourceChunks = jest.fn();
    const execution = jobExecution();
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding: jest.fn() },
      {
        readSourceSnapshot,
        resolveEmbedding: jest.fn(),
        replaceSourceChunks: jest.fn(),
        removeMissingSourceChunks,
      },
      execution.executor,
    );

    await expect(
      handler.handle({
        ...JOB,
        payload: {
          sourceKind: 'course_step',
          sourceId: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    ).rejects.toThrow('INVALID_RETRIEVAL_PAYLOAD');
    expect(readSourceSnapshot).not.toHaveBeenCalled();
    expect(removeMissingSourceChunks).not.toHaveBeenCalled();
  });

  it('keeps a provider outage retriable instead of writing a terminal result', async () => {
    const execution = jobExecution();
    const providerFailure = new Error('OpenAI unavailable');
    const embedding = jest
      .fn()
      .mockRejectedValueOnce(providerFailure)
      .mockResolvedValue({
        model: 'text-embedding-3-small',
        dimensions: 1536,
        embedding: VECTOR,
      });
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(POST_SNAPSHOT),
        resolveEmbedding: (_input, load) => load(),
        replaceSourceChunks: jest.fn().mockResolvedValue('stored'),
      },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toBe(providerFailure);
    expect(execution.store.findDeadLetter(JOB)).toBeNull();
    await expect(handler.handle(JOB)).resolves.toMatchObject({
      indexingOutcome: 'stored',
    });
    expect(embedding).toHaveBeenCalledTimes(4);
  });

  it('atomically records a redacted terminal result on the final provider attempt', async () => {
    const execution = jobExecution();
    const rawFailure =
      'Bearer retrieval-secret-canary https://embed:retrieval-url-secret@example.invalid/v1?api_key=retrieval-query-secret';
    const embedding = jest.fn().mockRejectedValue(new Error(rawFailure));
    const handler = new RetrievalEmbeddingJobHandler(
      { embedding },
      {
        readSourceSnapshot: () =>
          Promise.resolve({
            ...POST_SNAPSHOT,
            transcriptBody: 'One final retrieval chunk',
            translatedSegments: [],
          }),
        resolveEmbedding: (_input, load) => load(),
        replaceSourceChunks: jest.fn(),
      },
      execution.executor,
    );

    await expect(
      handler.handle(JOB, {
        attemptNumber: 8,
        maxAttempts: 8,
        isFinalAttempt: true,
      }),
    ).rejects.toMatchObject({
      code: 'EMBEDDING_ATTEMPTS_EXHAUSTED',
    });
    expect(execution.store.findResult(JOB)).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'EMBEDDING_ATTEMPTS_EXHAUSTED', attemptsMade: 8 },
    });
    expect(execution.store.findDeadLetter(JOB)).toMatchObject({
      code: 'EMBEDDING_ATTEMPTS_EXHAUSTED',
      details: { attemptsMade: 8 },
    });
    const persisted = JSON.stringify({
      result: execution.store.findResult(JOB),
      deadLetter: execution.store.findDeadLetter(JOB),
    });
    expect(persisted).not.toContain('retrieval-secret-canary');
    expect(persisted).not.toContain('retrieval-url-secret');
    expect(persisted).not.toContain('retrieval-query-secret');

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'EMBEDDING_ATTEMPTS_EXHAUSTED',
    });
    expect(embedding).toHaveBeenCalledTimes(1);
  });
});

describe('buildRetrievalChunks', () => {
  it('keeps long transcript chunks bounded with matched timestamp ranges', () => {
    const chunks = buildRetrievalChunks(POST_SNAPSHOT);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(
      chunks.every(
        (chunk) => chunk.content.length <= RETRIEVAL_CHUNK_MAX_CHARACTERS,
      ),
    ).toBe(true);
    expect(chunks[2]).toMatchObject({ startSeconds: 12, endSeconds: 36 });
  });

  it('keeps immutable learning evidence identity on every indexed chunk', () => {
    const chunks = buildRetrievalChunks({
      ...POST_SNAPSHOT,
      sourceKind: 'learning_context',
      sourceId: '81',
      sourceVersion: '5',
      visibility: 'private',
      evidenceItems: [
        {
          kind: 'caption_segment',
          resourceId: 'caption-segment:701',
          content: '격리 수준은 동시성 제어 규칙입니다.',
          startSeconds: 30,
          endSeconds: 42,
          sourceUrl: 'https://youtu.be/caption0001?t=30s',
          readiness: 'ready',
          artifactId: '61',
          segmentId: '701',
          artifactGeneration: 4,
        },
        {
          kind: 'learning_note',
          resourceId: 'learning-note:91',
          content: '직렬화 실패는 재시도한다.',
          startSeconds: 35,
          endSeconds: 36,
          sourceUrl: 'https://youtu.be/caption0001?t=35s',
          readiness: 'ready',
          noteId: '91',
          artifactGeneration: 4,
        },
      ],
    });

    expect(chunks).toEqual([
      expect.objectContaining({
        content: '격리 수준은 동시성 제어 규칙입니다.',
        resourceId: 'caption-segment:701',
        evidenceKind: 'caption_segment',
        evidenceArtifactId: '61',
        evidenceSegmentId: '701',
        artifactGeneration: 4,
      }),
      expect.objectContaining({
        content: '직렬화 실패는 재시도한다.',
        resourceId: 'learning-note:91',
        evidenceKind: 'learning_note',
        evidenceNoteId: '91',
        artifactGeneration: 4,
      }),
    ]);
  });
});

function jobExecution(): {
  store: MemoryJobExecutionStore;
  executor: DurableJobExecutor;
} {
  const store = new MemoryJobExecutionStore();
  return {
    store,
    executor: new DurableJobExecutor(store, {
      leaseOwner: 'retrieval-worker',
      leaseMs: 30_000,
    }),
  };
}
