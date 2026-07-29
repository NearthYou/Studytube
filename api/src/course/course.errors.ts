export type CourseErrorCode =
  | 'COURSE_INVALID_INPUT'
  | 'COURSE_NOT_FOUND'
  | 'COURSE_VERSION_CONFLICT'
  | 'COURSE_IDEMPOTENCY_CONFLICT'
  | 'COURSE_INVALID_LIFECYCLE'
  | 'COURSE_FEEDBACK_RATE_LIMITED'
  | 'COURSE_PERSISTENCE_UNAVAILABLE';

export abstract class CourseError extends Error {
  abstract readonly code: CourseErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class CourseValidationError extends CourseError {
  readonly code = 'COURSE_INVALID_INPUT' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export class CourseNotFoundError extends CourseError {
  readonly code = 'COURSE_NOT_FOUND' as const;

  constructor() {
    super('Course was not found');
  }
}

export class CourseVersionConflictError extends CourseError {
  readonly code = 'COURSE_VERSION_CONFLICT' as const;

  constructor(
    readonly expectedVersion: number,
    readonly currentVersion?: number,
  ) {
    super('Course version does not match the expected version');
  }
}

export class CourseIdempotencyConflictError extends CourseError {
  readonly code = 'COURSE_IDEMPOTENCY_CONFLICT' as const;

  constructor() {
    super('Idempotency key was already used with a different payload');
  }
}

export class CourseLifecycleError extends CourseError {
  readonly code = 'COURSE_INVALID_LIFECYCLE' as const;

  constructor(message = 'Course lifecycle transition is not allowed') {
    super(message);
  }
}

export class CourseFeedbackRateLimitedError extends CourseError {
  readonly code = 'COURSE_FEEDBACK_RATE_LIMITED' as const;

  constructor(readonly retryAfterSeconds: number) {
    super('Course feedback rate limit exceeded');
  }
}

export class CoursePersistenceUnavailableError extends CourseError {
  readonly code = 'COURSE_PERSISTENCE_UNAVAILABLE' as const;

  constructor(options?: ErrorOptions) {
    super('Course persistence is temporarily unavailable', options);
  }
}
