export type LearningErrorCode =
  | 'LEARNING_INVALID_INPUT'
  | 'LEARNING_NOT_FOUND'
  | 'LEARNING_VERSION_CONFLICT'
  | 'LEARNING_IDEMPOTENCY_CONFLICT'
  | 'LEARNING_INVALID_LIFECYCLE'
  | 'LEARNING_ATTEMPT_LIMIT_REACHED'
  | 'LEARNING_EVIDENCE_NOT_READY'
  | 'LEARNING_QUIZ_STALE'
  | 'LEARNING_PROPOSAL_EXPIRED'
  | 'LEARNING_PROPOSAL_REJECTED'
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

export class LearningEvidenceNotReadyError extends LearningError {
  readonly code = 'LEARNING_EVIDENCE_NOT_READY' as const;

  constructor() {
    super('자막 근거를 준비하고 있습니다. 준비가 끝난 뒤 다시 시도해주세요.');
  }
}

export class LearningQuizStaleError extends LearningError {
  readonly code = 'LEARNING_QUIZ_STALE' as const;

  constructor() {
    super('자막이 바뀌었습니다. 새 퀴즈를 만들어주세요.');
  }
}

export class LearningProposalExpiredError extends LearningError {
  readonly code = 'LEARNING_PROPOSAL_EXPIRED' as const;

  constructor() {
    super('제안이 만료되었습니다. 새 제안을 요청해주세요.');
  }
}

export class LearningProposalRejectedError extends LearningError {
  readonly code = 'LEARNING_PROPOSAL_REJECTED' as const;

  constructor() {
    super('이미 거절한 제안입니다. 새 제안을 요청해주세요.');
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
