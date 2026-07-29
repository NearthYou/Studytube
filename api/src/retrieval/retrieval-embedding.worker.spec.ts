import type { JobResult } from '../work/work.types';
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
  it('embeds every bounded timestamp chunk before replacing the whole source once', async () => {
    let result: JobResult | null = null;
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
      legacySources(),
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(POST_SNAPSHOT),
        resolveEmbedding,
        replaceSourceChunks,
      },
      resultStore(
        () => result,
        (next) => {
          result ??= next;
        },
      ),
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
    const handler = new RetrievalEmbeddingJobHandler(
      legacySources(),
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
      resultStore(() => null),
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
    const handler = new RetrievalEmbeddingJobHandler(
      legacySources(),
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(POST_SNAPSHOT),
        resolveEmbedding: jest.fn(),
        replaceSourceChunks,
      },
      resultStore(() => null),
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
    let result: JobResult | null = null;
    const removeMissingSourceChunks = jest.fn().mockResolvedValue('removed');
    const embedding = jest.fn();
    const handler = new RetrievalEmbeddingJobHandler(
      legacySources(),
      { embedding },
      {
        readSourceSnapshot: () => Promise.resolve(null),
        resolveEmbedding: jest.fn(),
        replaceSourceChunks: jest.fn(),
        removeMissingSourceChunks,
      },
      resultStore(
        () => result,
        (next) => {
          result ??= next;
        },
      ),
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
    const handler = new RetrievalEmbeddingJobHandler(
      legacySources(),
      { embedding: jest.fn() },
      {
        readSourceSnapshot,
        resolveEmbedding: jest.fn(),
        replaceSourceChunks: jest.fn(),
        removeMissingSourceChunks,
      },
      resultStore(() => null),
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
    const recordDeadLetter = jest.fn().mockResolvedValue(true);
    const handler = new RetrievalEmbeddingJobHandler(
      legacySources(),
      { embedding: () => Promise.reject(new Error('OpenAI unavailable')) },
      {
        readSourceSnapshot: () => Promise.resolve(POST_SNAPSHOT),
        resolveEmbedding: (_input, load) => load(),
        replaceSourceChunks: jest.fn(),
      },
      {
        findJobResult: () => Promise.resolve(null),
        recordJobResult: jest.fn().mockResolvedValue(true),
        recordDeadLetter,
      },
    );

    await expect(handler.handle(JOB)).rejects.toThrow('OpenAI unavailable');
    expect(recordDeadLetter).not.toHaveBeenCalled();
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
});

function legacySources() {
  return {
    findPost: () => Promise.resolve(null),
    findVideoAsset: () => Promise.resolve(null),
  };
}

function resultStore(
  get: () => JobResult | null,
  set: (result: JobResult) => void = () => undefined,
) {
  return {
    findJobResult: () => Promise.resolve(get()),
    recordJobResult: (input: JobResult) => {
      set(input);
      return Promise.resolve(true);
    },
    recordDeadLetter: () => Promise.resolve(true),
  };
}
