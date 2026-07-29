import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { MetricRegistry, StudyTubeMetrics } from './metrics';
import { observePostgresPool } from './postgres-pool-observer';

describe('PostgreSQL pool observation', () => {
  it('records promise acquisition latency and current pool pressure', async () => {
    const pool = new FakePool();
    const registry = new MetricRegistry();
    const metrics = new StudyTubeMetrics(registry);
    const clock = sequenceClock(100, 135);
    const stop = observePostgresPool(pool as unknown as Pool, metrics, clock);

    const connection = pool.connect();
    expect(registry.toPrometheus()).toContain('studytube_db_pool_waiting 1');

    pool.succeed({} as PoolClient, {
      total: 4,
      idle: 1,
      waiting: 0,
    });
    await expect(connection).resolves.toBeDefined();

    const output = registry.toPrometheus();
    expect(output).toContain('studytube_db_pool_wait_ms_sum 35');
    expect(output).toContain('studytube_db_pool_connections{state="total"} 4');
    expect(output).toContain('studytube_db_pool_connections{state="idle"} 1');
    expect(output).toContain('studytube_db_pool_connections{state="busy"} 3');
    expect(output).toContain('studytube_db_pool_waiting 0');
    stop();
  });

  it('records failed callback acquisitions used by pool.query', () => {
    const pool = new FakePool();
    const registry = new MetricRegistry();
    const metrics = new StudyTubeMetrics(registry);
    const clock = sequenceClock(30, 42);
    const callback = jest.fn();
    const stop = observePostgresPool(pool as unknown as Pool, metrics, clock);

    pool.connect(callback);
    const error = new Error('pool timeout');
    pool.fail(error);

    expect(callback).toHaveBeenCalledWith(
      error,
      undefined,
      expect.any(Function),
    );
    expect(registry.toPrometheus()).toContain(
      'studytube_db_pool_wait_ms_sum 12',
    );
    stop();
  });

  it('updates idle connection gauges after release events settle', async () => {
    const pool = new FakePool();
    const registry = new MetricRegistry();
    const metrics = new StudyTubeMetrics(registry);
    const stop = observePostgresPool(pool as unknown as Pool, metrics, () => 0);

    pool.setState({ total: 3, idle: 2, waiting: 0 });
    pool.emit('release', undefined, {});
    await Promise.resolve();

    const output = registry.toPrometheus();
    expect(output).toContain('studytube_db_pool_connections{state="idle"} 2');
    expect(output).toContain('studytube_db_pool_connections{state="busy"} 1');
    stop();
  });
});

type ConnectionCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

class FakePool extends EventEmitter {
  totalCount = 0;
  idleCount = 0;
  waitingCount = 0;
  private callback?: ConnectionCallback;
  private resolve?: (client: PoolClient) => void;
  private reject?: (error: Error) => void;

  connect(): Promise<PoolClient>;
  connect(callback: ConnectionCallback): void;
  connect(callback?: ConnectionCallback): Promise<PoolClient> | void {
    this.waitingCount = 1;
    if (callback) {
      this.callback = callback;
      return;
    }
    return new Promise<PoolClient>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  succeed(
    client: PoolClient,
    state: { total: number; idle: number; waiting: number },
  ): void {
    this.setState(state);
    const done = () => undefined;
    this.emit('acquire', client);
    this.callback?.(undefined, client, done);
    this.resolve?.(client);
  }

  fail(error: Error): void {
    this.waitingCount = 0;
    this.callback?.(error, undefined, () => undefined);
    this.reject?.(error);
  }

  setState(state: { total: number; idle: number; waiting: number }): void {
    this.totalCount = state.total;
    this.idleCount = state.idle;
    this.waitingCount = state.waiting;
  }
}

function sequenceClock(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}
