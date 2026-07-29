export type LearningErrorCode =
  | 'LEARNING_INVALID_INPUT'
  | 'LEARNING_NOT_FOUND'
  | 'LEARNING_VERSION_CONFLICT'
  | 'LEARNING_IDEMPOTENCY_CONFLICT'
  | 'LEARNING_INVALID_LIFECYCLE'
  | 'LEARNING_ATTEMPT_LIMIT_REACHED'
  | 'LEARNING_LEASE_LOST'
  | 'LEARNING_PERSISTENCE_UNAVAILABLE';

export abstract class LearningError extends Error {
  abstract readonly code: LearningErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class LearningValidationError extends LearningError {
  readonly code = 'LEARNING_INVALID_INPUT' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export class LearningNotFoundError extends LearningError {
  readonly code = 'LEARNING_NOT_FOUND' as const;

  constructor() {
    super('Learning resource was not found');
  }
}

export class LearningVersionConflictError extends LearningError {
  readonly code = 'LEARNING_VERSION_CONFLICT' as const;

  constructor(
    readonly expectedVersion: number,
    readonly currentVersion?: number,
  ) {
    super('Learning resource version does not match the expected version');
  }
}

export class LearningIdempotencyConflictError extends LearningError {
  readonly code = 'LEARNING_IDEMPOTENCY_CONFLICT' as const;

  constructor() {
    super('Idempotency key was already used with a different payload');
  }
}

export class LearningLifecycleError extends LearningError {
  readonly code = 'LEARNING_INVALID_LIFECYCLE' as const;

  constructor(message = 'Learning lifecycle transition is not allowed') {
    super(message);
  }
}

export class LearningAttemptLimitError extends LearningError {
  readonly code = 'LEARNING_ATTEMPT_LIMIT_REACHED' as const;

  constructor() {
    super('Quiz attempt limit has been reached');
  }
}

export class LearningLeaseLostError extends LearningError {
  readonly code = 'LEARNING_LEASE_LOST' as const;

  constructor() {
    super('AgentRun worker lease is no longer valid');
  }
}

export class LearningPersistenceUnavailableError extends LearningError {
  readonly code = 'LEARNING_PERSISTENCE_UNAVAILABLE' as const;

  constructor(options?: ErrorOptions) {
    super('Learning persistence is temporarily unavailable', options);
  }
}
