import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { platform } from 'node:os';
import {
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_SALT_BYTES,
  ARGON2_TAG_BYTES,
  ARGON2_TIME_COST,
  AUTH_ARGON2_DEFAULT_QUEUE_SIZE,
  AUTH_ARGON2_MEMORY_BUDGET_MIB,
} from '../src/auth/auth.constants';
import {
  Argon2QueueOverflowError,
  Argon2WorkLimiter,
} from '../src/auth/argon2-work-limiter';
import { PasswordHasher } from '../src/auth/password-hasher';

type LatencySummary = {
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
};

type BenchmarkOptions = {
  samples: number;
  warmup: number;
  concurrency: number;
  saturateQueue: boolean;
};

const options = parseOptions(process.argv.slice(2));
const limiter = new Argon2WorkLimiter({
  concurrency: options.concurrency,
  maxQueueSize: AUTH_ARGON2_DEFAULT_QUEUE_SIZE,
  memoryBudgetMiB: AUTH_ARGON2_MEMORY_BUDGET_MIB,
});
const hasher = new PasswordHasher({ limiter });
const benchmarkPassword = 'benchmark-password-value';
const baselineRssBytes = process.memoryUsage.rss();
let peakRssBytes = baselineRssBytes;
const rssSampler = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
}, 5);
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelay.enable();

async function main(): Promise<void> {
  for (let index = 0; index < options.warmup; index += 1) {
    const encoded = await hasher.hash(benchmarkPassword);
    await hasher.verify(encoded, benchmarkPassword);
  }

  const sequential = await measureSequential(options.samples);
  const concurrent = await measureConcurrent(
    options.samples,
    options.concurrency,
  );
  const argon2PeakConcurrency = limiter.metrics.peakActiveJobs;
  const overflow = options.saturateQueue
    ? await measureQueueSaturation(limiter)
    : {
        tested: false,
        rejected: false,
        code: null,
        retryAfterSeconds: null,
      };

  clearInterval(rssSampler);
  eventLoopDelay.disable();
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
  const bytesPerMiB = 1024 * 1024;
  const peakRssIncreaseMiB = (peakRssBytes - baselineRssBytes) / bytesPerMiB;
  const checks = {
    singleMedianWithinCeiling: sequential.hash.medianMs <= 500,
    memoryWithinBudget: peakRssIncreaseMiB <= AUTH_ARGON2_MEMORY_BUDGET_MIB,
    overloadRejected: !options.saturateQueue || overflow.rejected,
    requestedConcurrencyAchieved: argon2PeakConcurrency === options.concurrency,
  };
  const report = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: platform(),
    options,
    policy: {
      algorithm: 'argon2id',
      memoryKiB: ARGON2_MEMORY_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
      tagBytes: ARGON2_TAG_BYTES,
      saltBytes: ARGON2_SALT_BYTES,
      limiter: limiter.policy,
    },
    latency: {
      sequential,
      concurrent,
    },
    memory: {
      baselineRssMiB: round(baselineRssBytes / bytesPerMiB),
      peakRssMiB: round(peakRssBytes / bytesPerMiB),
      peakRssIncreaseMiB: round(peakRssIncreaseMiB),
      declaredArgon2BudgetMiB: AUTH_ARGON2_MEMORY_BUDGET_MIB,
    },
    eventLoopDelay: {
      meanMs: round(nanosecondsToMilliseconds(eventLoopDelay.mean)),
      p95Ms: round(nanosecondsToMilliseconds(eventLoopDelay.percentile(95))),
      maxMs: round(nanosecondsToMilliseconds(eventLoopDelay.max)),
    },
    overflow,
    concurrencyEvidence: {
      requested: options.concurrency,
      achieved: argon2PeakConcurrency,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

async function measureSequential(samples: number): Promise<{
  hash: LatencySummary;
  verify: LatencySummary;
}> {
  const hashLatencies: number[] = [];
  const verifyLatencies: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const [encoded, hashDuration] = await timed(() =>
      hasher.hash(benchmarkPassword),
    );
    hashLatencies.push(hashDuration);
    const [verification, verifyDuration] = await timed(() =>
      hasher.verify(encoded, benchmarkPassword),
    );
    if (!verification.valid) {
      throw new Error('Password verification failed during benchmark');
    }
    verifyLatencies.push(verifyDuration);
  }
  return {
    hash: summarize(hashLatencies),
    verify: summarize(verifyLatencies),
  };
}

async function measureConcurrent(
  samples: number,
  concurrency: number,
): Promise<{
  hash: LatencySummary;
  verify: LatencySummary;
}> {
  const hashLatencies: number[] = [];
  const verifyLatencies: number[] = [];
  for (let offset = 0; offset < samples; offset += concurrency) {
    const batchSize = Math.min(concurrency, samples - offset);
    const hashes = await Promise.all(
      Array.from({ length: batchSize }, () =>
        timed(() => hasher.hash(benchmarkPassword)),
      ),
    );
    hashLatencies.push(...hashes.map(([, duration]) => duration));
    const verifications = await Promise.all(
      hashes.map(([encoded]) =>
        timed(() => hasher.verify(encoded, benchmarkPassword)),
      ),
    );
    if (verifications.some(([result]) => !result.valid)) {
      throw new Error('Concurrent password verification failed');
    }
    verifyLatencies.push(...verifications.map(([, duration]) => duration));
  }
  return {
    hash: summarize(hashLatencies),
    verify: summarize(verifyLatencies),
  };
}

async function measureQueueSaturation(limiterToTest: Argon2WorkLimiter) {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const admitted = Array.from(
    {
      length:
        limiterToTest.policy.concurrency + limiterToTest.policy.maxQueueSize,
    },
    () => limiterToTest.run(() => gate),
  );
  let overflow: Argon2QueueOverflowError | undefined;
  try {
    await limiterToTest.run(() => undefined);
  } catch (error) {
    if (error instanceof Argon2QueueOverflowError) {
      overflow = error;
    } else {
      throw error;
    }
  } finally {
    release?.();
    await Promise.all(admitted);
  }
  return {
    tested: true,
    rejected: overflow !== undefined,
    code: overflow?.code ?? null,
    retryAfterSeconds: overflow?.retryAfterSeconds ?? null,
  };
}

async function timed<T>(operation: () => Promise<T>): Promise<[T, number]> {
  const startedAt = performance.now();
  const result = await operation();
  return [result, performance.now() - startedAt];
}

function summarize(values: number[]): LatencySummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    medianMs: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1) ?? sorted[0]),
  };
}

function percentile(sorted: number[], value: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((value / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

function nanosecondsToMilliseconds(value: number): number {
  return Number.isFinite(value) ? value / 1_000_000 : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseOptions(args: string[]): BenchmarkOptions {
  const values = new Map<string, string>();
  let saturateQueue = false;
  for (const argument of args) {
    if (argument === '--saturate-queue') {
      saturateQueue = true;
      continue;
    }
    const match = /^--(samples|warmup|concurrency)=(\d+)$/u.exec(argument);
    if (!match) {
      throw new Error(`Unknown benchmark option: ${argument}`);
    }
    values.set(match[1], match[2]);
  }
  const parsedOptions = {
    samples: parseInteger(values.get('samples') ?? '5', 'samples', 1),
    warmup: parseInteger(values.get('warmup') ?? '1', 'warmup', 0),
    concurrency: parseInteger(
      values.get('concurrency') ?? '2',
      'concurrency',
      1,
    ),
    saturateQueue,
  };
  if (parsedOptions.samples < parsedOptions.concurrency) {
    throw new RangeError(
      'samples must be greater than or equal to concurrency',
    );
  }
  return parsedOptions;
}

function parseInteger(value: string, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RangeError(`${name} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

void main().catch((error: unknown) => {
  clearInterval(rssSampler);
  eventLoopDelay.disable();
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ error: 'benchmark_failed', message })}\n`,
  );
  process.exitCode = 1;
});
