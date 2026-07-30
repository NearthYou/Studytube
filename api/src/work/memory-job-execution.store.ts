import { randomUUID } from 'node:crypto';
import type {
  JobExecutionAcquisition,
  JobExecutionCompletion,
  JobExecutionDeadLetter,
  JobExecutionKey,
  JobExecutionRecord,
  JobExecutionStore,
} from './job-execution.store';
import { WorkJobLeaseLostError } from './work.errors';

type MemoryClaim = {
  leaseOwner: string;
  leaseToken: string;
  expiresAt: number;
};

export class MemoryJobExecutionStore implements JobExecutionStore {
  private readonly claims = new Map<string, MemoryClaim>();
  private readonly results = new Map<string, JobExecutionRecord>();
  private readonly deadLetters = new Map<string, JobExecutionDeadLetter>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(
    key: JobExecutionKey,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<JobExecutionAcquisition> {
    const id = this.id(key);
    const record = this.results.get(id);
    if (record) {
      return Promise.resolve({ status: 'completed', record });
    }
    const current = this.claims.get(id);
    if (current && current.expiresAt > this.now()) {
      return Promise.resolve({ status: 'busy' });
    }
    const leaseToken = randomUUID();
    this.claims.set(id, {
      leaseOwner,
      leaseToken,
      expiresAt: this.now() + leaseMs,
    });
    return Promise.resolve({ status: 'acquired', leaseToken });
  }

  complete(
    key: JobExecutionKey,
    leaseToken: string,
    completion: JobExecutionCompletion,
  ): Promise<void> {
    const id = this.id(key);
    const claim = this.claims.get(id);
    if (
      !claim ||
      claim.leaseToken !== leaseToken ||
      claim.expiresAt <= this.now()
    ) {
      return Promise.reject(new WorkJobLeaseLostError());
    }
    this.results.set(id, {
      ...key,
      outcome: completion.outcome,
      result: completion.result,
    });
    if (completion.deadLetter) {
      this.deadLetters.set(id, completion.deadLetter);
    }
    this.claims.delete(id);
    return Promise.resolve();
  }

  renew(
    key: JobExecutionKey,
    leaseToken: string,
    leaseMs: number,
  ): Promise<boolean> {
    const id = this.id(key);
    const claim = this.claims.get(id);
    if (
      !claim ||
      claim.leaseToken !== leaseToken ||
      claim.expiresAt <= this.now()
    ) {
      return Promise.resolve(false);
    }
    claim.expiresAt = this.now() + leaseMs;
    return Promise.resolve(true);
  }

  release(key: JobExecutionKey, leaseToken: string): Promise<boolean> {
    const id = this.id(key);
    if (this.claims.get(id)?.leaseToken !== leaseToken) {
      return Promise.resolve(false);
    }
    this.claims.delete(id);
    return Promise.resolve(true);
  }

  findResult(key: JobExecutionKey): JobExecutionRecord | null {
    return this.results.get(this.id(key)) ?? null;
  }

  findDeadLetter(key: JobExecutionKey): JobExecutionDeadLetter | null {
    return this.deadLetters.get(this.id(key)) ?? null;
  }

  private id(key: JobExecutionKey): string {
    return `${key.eventId}:${key.handlerVersion}`;
  }
}
