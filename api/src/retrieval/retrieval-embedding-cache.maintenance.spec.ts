import {
  resolveRetrievalEmbeddingCacheMaintenanceOptions,
  RetrievalEmbeddingCacheMaintenance,
} from './retrieval-embedding-cache.maintenance';

describe('RetrievalEmbeddingCacheMaintenance', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports a failed cycle once and waits for the interval before retrying', async () => {
    jest.useFakeTimers();
    const failure = new Error('database unavailable');
    const pruneEmbeddingCache = jest.fn().mockRejectedValue(failure);
    const onError = jest.fn();
    const maintenance = new RetrievalEmbeddingCacheMaintenance(
      { pruneEmbeddingCache },
      {
        retentionDays: 90,
        batchSize: 100,
        intervalMs: 1_000,
        onError,
      },
    );

    maintenance.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    expect(pruneEmbeddingCache).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    await jest.advanceTimersByTimeAsync(999);
    expect(pruneEmbeddingCache).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(pruneEmbeddingCache).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);

    await maintenance.onModuleDestroy();
  });

  it('never overlaps runs and waits for the active run during shutdown', async () => {
    jest.useFakeTimers();
    let finish: ((removed: number) => void) | undefined;
    const pruneEmbeddingCache = jest.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const maintenance = new RetrievalEmbeddingCacheMaintenance(
      { pruneEmbeddingCache },
      { retentionDays: 90, batchSize: 100, intervalMs: 10 },
    );

    maintenance.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    const shutdown = maintenance.onModuleDestroy();
    let stopped = false;
    void shutdown.then(() => {
      stopped = true;
    });

    await jest.advanceTimersByTimeAsync(100);
    expect(pruneEmbeddingCache).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(false);

    finish?.(1);
    await shutdown;
    await jest.advanceTimersByTimeAsync(100);
    expect(pruneEmbeddingCache).toHaveBeenCalledTimes(1);
  });
});

describe('resolveRetrievalEmbeddingCacheMaintenanceOptions', () => {
  it('uses conservative bounded defaults and clamps unsafe production values', () => {
    expect(resolveRetrievalEmbeddingCacheMaintenanceOptions({})).toEqual({
      retentionDays: 90,
      batchSize: 100,
      intervalMs: 21_600_000,
    });
    expect(
      resolveRetrievalEmbeddingCacheMaintenanceOptions({
        RETRIEVAL_EMBEDDING_CACHE_RETENTION_DAYS: '1',
        RETRIEVAL_EMBEDDING_CACHE_PRUNE_BATCH_SIZE: '50000',
        RETRIEVAL_EMBEDDING_CACHE_MAINTENANCE_INTERVAL_MS: '1',
      }),
    ).toEqual({
      retentionDays: 30,
      batchSize: 500,
      intervalMs: 300_000,
    });
  });
});
