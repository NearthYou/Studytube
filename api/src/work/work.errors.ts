export class WorkJobBusyError extends Error {
  readonly code = 'JOB_EXECUTION_BUSY';

  constructor() {
    super('JOB_EXECUTION_BUSY');
  }
}

export class WorkJobLeaseLostError extends Error {
  readonly code = 'JOB_EXECUTION_LEASE_LOST';

  constructor() {
    super('JOB_EXECUTION_LEASE_LOST');
  }
}

export class WorkJobCompletionConflictError extends Error {
  readonly code = 'JOB_EXECUTION_COMPLETION_CONFLICT';

  constructor() {
    super('JOB_EXECUTION_COMPLETION_CONFLICT');
  }
}

export type WorkJobTerminalErrorOptions = {
  message?: string;
  details?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export class WorkJobTerminalError extends Error {
  readonly details?: Record<string, unknown>;
  readonly result: Record<string, unknown>;

  constructor(
    readonly code: string,
    options: WorkJobTerminalErrorOptions = {},
  ) {
    super(options.message ?? code);
    this.details = options.details;
    this.result = options.result ?? { code };
  }
}
