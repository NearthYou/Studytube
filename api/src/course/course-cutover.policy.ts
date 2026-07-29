export type CourseCutoverMode = 'legacy' | 'freeze' | 'course';

export const COURSE_CUTOVER_ADVISORY_LOCK_KEY = 2_026_072_901;

type CourseCutoverOperation =
  | 'legacy mutation'
  | 'source mutation'
  | 'Course mutation'
  | 'Course backfill';

export class CourseCutoverPolicyError extends Error {
  constructor(
    readonly mode: CourseCutoverMode | 'invalid',
    readonly operation: CourseCutoverOperation | 'startup',
    message: string,
  ) {
    super(message);
    this.name = CourseCutoverPolicyError.name;
  }
}

export class CourseCutoverPolicy {
  constructor(readonly mode: CourseCutoverMode) {}

  assertLegacyMutationAllowed(): void {
    if (this.mode !== 'legacy') {
      this.reject('legacy mutation');
    }
  }

  assertCourseMutationAllowed(): void {
    if (this.mode !== 'course') {
      this.reject('Course mutation');
    }
  }

  assertSourceMutationAllowed(): void {
    if (this.mode === 'freeze') {
      this.reject('source mutation');
    }
  }

  assertBackfillAllowed(): void {
    if (this.mode === 'course') {
      this.reject('Course backfill');
    }
  }

  private reject(operation: CourseCutoverOperation): never {
    throw new CourseCutoverPolicyError(
      this.mode,
      operation,
      `${operation} is disabled while Course cutover mode is ${this.mode}`,
    );
  }
}

export function resolveCourseCutoverMode(
  configuredMode: string | undefined,
  environment: string | undefined,
): CourseCutoverMode {
  const normalized = configuredMode?.trim().toLowerCase();

  if (
    normalized === 'legacy' ||
    normalized === 'freeze' ||
    normalized === 'course'
  ) {
    return normalized;
  }

  if (environment !== 'production' && !normalized) {
    return 'legacy';
  }

  throw new CourseCutoverPolicyError(
    'invalid',
    'startup',
    'COURSE_CUTOVER_MODE must be explicitly set to legacy, freeze, or course',
  );
}
