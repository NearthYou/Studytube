import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RetrievalRepository } from './retrieval.repository';

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_BATCH_SIZE = 100;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 500;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheMaintenanceRepository = Pick<
  RetrievalRepository,
  'pruneEmbeddingCache'
>;

export type RetrievalEmbeddingCacheMaintenanceOptions = {
  retentionDays: number;
  batchSize: number;
  intervalMs: number;
  onError?: (error: unknown) => void;
};

export class RetrievalEmbeddingCacheMaintenance
  implements OnModuleInit, OnModuleDestroy
{
  private stopped = true;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<number>;

  constructor(
    private readonly repository: CacheMaintenanceRepository,
    private readonly options: RetrievalEmbeddingCacheMaintenanceOptions,
  ) {
    for (const [name, value] of Object.entries({
      retentionDays: options.retentionDays,
      batchSize: options.batchSize,
      intervalMs: options.intervalMs,
    })) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`Retrieval cache maintenance ${name} is invalid`);
      }
    }
  }

  onModuleInit(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  async maintainOnce(): Promise<number | null> {
    if (this.inFlight) {
      return null;
    }
    const task = this.repository.pruneEmbeddingCache({
      retentionDays: this.options.retentionDays,
      batchSize: this.options.batchSize,
    });
    this.inFlight = task;
    try {
      return await task;
    } finally {
      if (this.inFlight === task) {
        this.inFlight = undefined;
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runScheduledCycle();
    }, delayMs);
    this.timer.unref?.();
  }

  private async runScheduledCycle(): Promise<void> {
    try {
      await this.maintainOnce();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.schedule(this.options.intervalMs);
    }
  }
}

export function resolveRetrievalEmbeddingCacheMaintenanceOptions(
  environment: NodeJS.ProcessEnv,
): Omit<RetrievalEmbeddingCacheMaintenanceOptions, 'onError'> {
  return {
    retentionDays: environmentInteger(
      environment.RETRIEVAL_EMBEDDING_CACHE_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      MIN_RETENTION_DAYS,
      MAX_RETENTION_DAYS,
    ),
    batchSize: environmentInteger(
      environment.RETRIEVAL_EMBEDDING_CACHE_PRUNE_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MIN_BATCH_SIZE,
      MAX_BATCH_SIZE,
    ),
    intervalMs: environmentInteger(
      environment.RETRIEVAL_EMBEDDING_CACHE_MAINTENANCE_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    ),
  };
}

function environmentInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(parsed, maximum));
}
