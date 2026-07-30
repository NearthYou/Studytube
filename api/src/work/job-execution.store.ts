export type JobExecutionKey = {
  eventId: string;
  handlerVersion: string;
};

export type JobExecutionRecord = JobExecutionKey & {
  outcome: 'succeeded' | 'terminal_failure';
  result: Record<string, unknown>;
};

export type JobExecutionDeadLetter = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type JobExecutionCompletion = {
  outcome: JobExecutionRecord['outcome'];
  result: Record<string, unknown>;
  deadLetter?: JobExecutionDeadLetter;
};

export type JobExecutionAcquisition =
  | { status: 'completed'; record: JobExecutionRecord }
  | { status: 'busy' }
  | { status: 'acquired'; leaseToken: string };

export interface JobExecutionStore {
  acquire(
    key: JobExecutionKey,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<JobExecutionAcquisition>;
  complete(
    key: JobExecutionKey,
    leaseToken: string,
    completion: JobExecutionCompletion,
  ): Promise<void>;
  renew(
    key: JobExecutionKey,
    leaseToken: string,
    leaseMs: number,
  ): Promise<boolean>;
  release(key: JobExecutionKey, leaseToken: string): Promise<boolean>;
}
