import type { Pool, PoolClient } from 'pg';
import type { StudyTubeMetrics } from './metrics';

type ConnectionCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

type ConnectImplementation = (
  callback?: ConnectionCallback,
) => Promise<PoolClient> | void;

const stateEvents = ['connect', 'acquire', 'release', 'remove'] as const;

export function observePostgresPool(
  pool: Pool,
  metrics: Pick<StudyTubeMetrics, 'dbPoolSnapshot' | 'dbPoolWait'>,
  now: () => number = performance.now.bind(performance),
): () => void {
  const originalConnect = pool.connect.bind(pool) as ConnectImplementation;
  let active = true;
  let snapshotQueued = false;

  const snapshot = () => {
    if (!active) {
      return;
    }
    metrics.dbPoolSnapshot(pool.totalCount, pool.idleCount, pool.waitingCount);
  };
  const scheduleSnapshot = () => {
    if (snapshotQueued) {
      return;
    }
    snapshotQueued = true;
    queueMicrotask(() => {
      snapshotQueued = false;
      snapshot();
    });
  };
  const acquisitionSettled = (startedAt: number) => {
    if (!active) {
      return;
    }
    metrics.dbPoolWait(Math.max(now() - startedAt, 0));
    snapshot();
  };

  const instrumentedConnect = ((callback?: ConnectionCallback) => {
    const startedAt = now();
    if (callback) {
      try {
        const result = originalConnect.call(pool, (error, client, done) => {
          acquisitionSettled(startedAt);
          callback(error, client, done);
        });
        snapshot();
        return result;
      } catch (error) {
        acquisitionSettled(startedAt);
        throw error;
      }
    }

    try {
      const connection = originalConnect.call(pool) as Promise<PoolClient>;
      snapshot();
      return connection.then(
        (client) => {
          acquisitionSettled(startedAt);
          return client;
        },
        (error: unknown) => {
          acquisitionSettled(startedAt);
          throw error;
        },
      );
    } catch (error) {
      acquisitionSettled(startedAt);
      throw error;
    }
  }) as Pool['connect'];

  pool.connect = instrumentedConnect;
  for (const eventName of stateEvents) {
    pool.on(eventName, scheduleSnapshot);
  }
  snapshot();

  return () => {
    if (!active) {
      return;
    }
    active = false;
    for (const eventName of stateEvents) {
      pool.removeListener(eventName, scheduleSnapshot);
    }
    if (pool.connect === instrumentedConnect) {
      pool.connect = originalConnect as Pool['connect'];
    }
  };
}
