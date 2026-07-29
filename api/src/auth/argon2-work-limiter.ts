import {
  ARGON2_MEMORY_PER_JOB_MIB,
  AUTH_ARGON2_DEFAULT_CONCURRENCY,
  AUTH_ARGON2_DEFAULT_QUEUE_SIZE,
  AUTH_ARGON2_MAX_QUEUE_SIZE,
  AUTH_ARGON2_MEMORY_BUDGET_MIB,
  AUTH_ARGON2_RETRY_AFTER_SECONDS,
} from './auth.constants';

export type Argon2WorkLimiterPolicy = {
  concurrency: number;
  maxQueueSize: number;
  memoryBudgetMiB: number;
  memoryPerJobMiB: number;
  retryAfterSeconds: number;
};

export type Argon2WorkLimiterOptions = {
  concurrency?: number;
  maxQueueSize?: number;
  memoryBudgetMiB?: number;
  retryAfterSeconds?: number;
};

export type Argon2WorkLimiterMetrics = {
  activeJobs: number;
  queuedJobs: number;
  peakActiveJobs: number;
};

export class Argon2QueueOverflowError extends Error {
  readonly code = 'AUTH_ARGON2_QUEUE_FULL';

  constructor(readonly retryAfterSeconds: number) {
    super('Password hashing capacity is temporarily full');
    this.name = 'Argon2QueueOverflowError';
  }
}

type QueuedJob<T> = {
  operation: () => Promise<T> | T;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export class Argon2WorkLimiter {
  readonly policy: Readonly<Argon2WorkLimiterPolicy>;
  private activeJobs = 0;
  private peakActiveJobs = 0;
  private readonly queue: Array<QueuedJob<unknown>> = [];

  constructor(options: Argon2WorkLimiterOptions = {}) {
    if (Object.hasOwn(options, 'memoryPerJobMiB')) {
      throw new TypeError('memoryPerJobMiB is not a configurable option');
    }
    const policy: Argon2WorkLimiterPolicy = {
      concurrency: options.concurrency ?? AUTH_ARGON2_DEFAULT_CONCURRENCY,
      maxQueueSize: options.maxQueueSize ?? AUTH_ARGON2_DEFAULT_QUEUE_SIZE,
      memoryBudgetMiB: options.memoryBudgetMiB ?? AUTH_ARGON2_MEMORY_BUDGET_MIB,
      memoryPerJobMiB: ARGON2_MEMORY_PER_JOB_MIB,
      retryAfterSeconds:
        options.retryAfterSeconds ?? AUTH_ARGON2_RETRY_AFTER_SECONDS,
    };
    this.assertValidPolicy(policy);
    this.policy = Object.freeze(policy);
  }

  get metrics(): Readonly<Argon2WorkLimiterMetrics> {
    return Object.freeze({
      activeJobs: this.activeJobs,
      queuedJobs: this.queue.length,
      peakActiveJobs: this.peakActiveJobs,
    });
  }

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.activeJobs < this.policy.concurrency) {
      return this.start(operation);
    }
    if (this.queue.length >= this.policy.maxQueueSize) {
      return Promise.reject(
        new Argon2QueueOverflowError(this.policy.retryAfterSeconds),
      );
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        operation,
        resolve,
        reject,
      });
    });
  }

  private start<T>(operation: () => Promise<T> | T): Promise<T> {
    this.activeJobs += 1;
    this.peakActiveJobs = Math.max(this.peakActiveJobs, this.activeJobs);
    return Promise.resolve()
      .then(operation)
      .finally(() => {
        this.activeJobs -= 1;
        this.startNext();
      });
  }

  private startNext(): void {
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    void this.start(next.operation).then(next.resolve, next.reject);
  }

  private assertValidPolicy(policy: Argon2WorkLimiterPolicy): void {
    for (const [name, value] of Object.entries(policy)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
      }
    }
    if (
      policy.concurrency < 1 ||
      policy.memoryPerJobMiB < 1 ||
      policy.memoryBudgetMiB < policy.memoryPerJobMiB
    ) {
      throw new RangeError('Argon2 concurrency exceeds the memory budget');
    }
    const memoryBound = Math.floor(
      policy.memoryBudgetMiB / ARGON2_MEMORY_PER_JOB_MIB,
    );
    if (policy.concurrency > memoryBound) {
      throw new RangeError('Argon2 concurrency exceeds the memory budget');
    }
    if (policy.retryAfterSeconds < 1) {
      throw new RangeError('retryAfterSeconds must be at least 1');
    }
    if (policy.maxQueueSize > AUTH_ARGON2_MAX_QUEUE_SIZE) {
      throw new RangeError(
        `Argon2 queue size must not exceed ${AUTH_ARGON2_MAX_QUEUE_SIZE}`,
      );
    }
  }
}
