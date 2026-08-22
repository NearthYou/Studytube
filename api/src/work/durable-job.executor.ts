import type {
  JobExecutionCompletion,
  JobExecutionKey,
  JobExecutionRecord,
  JobExecutionStore,
} from './job-execution.store';
import {
  WorkJobBusyError,
  WorkJobLeaseLostError,
  WorkJobTerminalError,
} from './work.errors';

export type DurableJobExecutorOptions = {
  leaseOwner: string;
  leaseMs: number;
};

export type DurableJobExhaustion = {
  code: string;
  attemptsMade: number;
};

export type DurableJobLease = Readonly<{
  leaseToken: string;
}>;

type JobHeartbeat = {
  signal: AbortSignal;
  stop(): Promise<boolean>;
};

export class DurableJobExecutor {
  constructor(
    private readonly store: JobExecutionStore,
    private readonly options: DurableJobExecutorOptions,
  ) {
    if (!options.leaseOwner.trim()) {
      throw new RangeError('leaseOwner must not be empty');
    }
    if (!Number.isInteger(options.leaseMs) || options.leaseMs < 3) {
      throw new RangeError('leaseMs must be an integer of at least 3');
    }
  }

  async execute(
    key: JobExecutionKey,
    task: (
      signal: AbortSignal,
      lease: DurableJobLease,
    ) => Promise<Record<string, unknown>>,
    exhaustion?: DurableJobExhaustion,
  ): Promise<Record<string, unknown>> {
    const acquisition = await this.store.acquire(
      key,
      this.options.leaseOwner,
      this.options.leaseMs,
    );
    if (acquisition.status === 'completed') {
      return this.replay(acquisition.record);
    }
    if (acquisition.status === 'busy') {
      throw new WorkJobBusyError();
    }

    const heartbeat = this.startHeartbeat(key, acquisition.leaseToken);
    let result: Record<string, unknown>;
    try {
      result = await task(heartbeat.signal, {
        leaseToken: acquisition.leaseToken,
      });
    } catch (error) {
      const leaseLost = await heartbeat.stop();
      if (leaseLost) {
        await this.release(key, acquisition.leaseToken);
        throw new WorkJobLeaseLostError();
      }
      const executionError = this.exhaustedFailure(error, exhaustion);
      if (executionError instanceof WorkJobTerminalError) {
        try {
          await this.store.complete(
            key,
            acquisition.leaseToken,
            this.terminalCompletion(executionError),
          );
        } catch (completionError) {
          await this.release(key, acquisition.leaseToken);
          throw completionError;
        }
        throw executionError;
      }
      await this.release(key, acquisition.leaseToken);
      throw executionError;
    }

    const leaseLost = await heartbeat.stop();
    if (leaseLost) {
      await this.release(key, acquisition.leaseToken);
      throw new WorkJobLeaseLostError();
    }
    try {
      await this.store.complete(key, acquisition.leaseToken, {
        outcome: 'succeeded',
        result,
      });
    } catch (error) {
      await this.release(key, acquisition.leaseToken);
      throw error;
    }
    return result;
  }

  private replay(record: JobExecutionRecord): Record<string, unknown> {
    if (record.outcome === 'terminal_failure') {
      const code =
        typeof record.result.code === 'string'
          ? record.result.code
          : 'TERMINAL_FAILURE';
      throw new WorkJobTerminalError(code, { result: record.result });
    }
    return record.result;
  }

  private terminalCompletion(
    error: WorkJobTerminalError,
  ): JobExecutionCompletion {
    return {
      outcome: 'terminal_failure',
      result: { ...error.result, code: error.code },
      deadLetter: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  private exhaustedFailure(
    error: unknown,
    exhaustion: DurableJobExhaustion | undefined,
  ): unknown {
    if (error instanceof WorkJobTerminalError || !exhaustion) {
      return error;
    }
    return new WorkJobTerminalError(exhaustion.code, {
      details: { attemptsMade: exhaustion.attemptsMade },
      result: {
        code: exhaustion.code,
        attemptsMade: exhaustion.attemptsMade,
      },
    });
  }

  private startHeartbeat(
    key: JobExecutionKey,
    leaseToken: string,
  ): JobHeartbeat {
    const controller = new AbortController();
    let stopped = false;
    let leaseLost = false;
    let renewalInFlight: Promise<void> | undefined;
    const loseLease = () => {
      if (leaseLost) return;
      leaseLost = true;
      clearInterval(timer);
      controller.abort(new WorkJobLeaseLostError());
    };
    const renew = () => {
      if (stopped || leaseLost || renewalInFlight) return;
      renewalInFlight = this.store
        .renew(key, leaseToken, this.options.leaseMs)
        .then((owned) => {
          if (!owned) {
            loseLease();
          }
        })
        .catch(() => {
          loseLease();
        })
        .finally(() => {
          renewalInFlight = undefined;
        });
    };
    const timer = setInterval(
      renew,
      Math.max(1, Math.floor(this.options.leaseMs / 3)),
    );
    timer.unref();
    return {
      signal: controller.signal,
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await renewalInFlight;
        return leaseLost;
      },
    };
  }

  private async release(
    key: JobExecutionKey,
    leaseToken: string,
  ): Promise<void> {
    try {
      await this.store.release(key, leaseToken);
    } catch {
      // Preserve the task or completion error that triggered release.
    }
  }
}
