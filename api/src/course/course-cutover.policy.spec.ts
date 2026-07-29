import {
  COURSE_CUTOVER_ADVISORY_LOCK_KEY,
  CourseCutoverPolicy,
  CourseCutoverPolicyError,
  resolveCourseCutoverMode,
} from './course-cutover.policy';

describe('CourseCutoverPolicy', () => {
  it.each([
    ['legacy', true, true, false, true],
    ['freeze', false, false, false, true],
    ['course', false, true, true, false],
  ] as const)(
    'enforces the %s authority matrix',
    (mode, legacyAllowed, sourceAllowed, courseAllowed, backfillAllowed) => {
      const policy = new CourseCutoverPolicy(mode);

      expectAdmission(
        () => policy.assertLegacyMutationAllowed(),
        legacyAllowed,
      );
      expectAdmission(
        () => policy.assertSourceMutationAllowed(),
        sourceAllowed,
      );
      expectAdmission(
        () => policy.assertCourseMutationAllowed(),
        courseAllowed,
      );
      expectAdmission(() => policy.assertBackfillAllowed(), backfillAllowed);
    },
  );

  it('requires an explicit valid mode in production', () => {
    expect(() => resolveCourseCutoverMode(undefined, 'production')).toThrow(
      CourseCutoverPolicyError,
    );
    expect(() => resolveCourseCutoverMode('invalid', 'production')).toThrow(
      CourseCutoverPolicyError,
    );
    expect(resolveCourseCutoverMode('course', 'production')).toBe('course');
  });

  it('defaults local and test processes to legacy authority', () => {
    expect(resolveCourseCutoverMode(undefined, 'development')).toBe('legacy');
    expect(resolveCourseCutoverMode('', 'test')).toBe('legacy');
  });

  it('uses a stable PostgreSQL advisory lock key', () => {
    expect(Number.isSafeInteger(COURSE_CUTOVER_ADVISORY_LOCK_KEY)).toBe(true);
    expect(COURSE_CUTOVER_ADVISORY_LOCK_KEY).toBeGreaterThan(0);
  });
});

function expectAdmission(operation: () => void, allowed: boolean): void {
  if (allowed) {
    expect(operation).not.toThrow();
    return;
  }

  expect(operation).toThrow(CourseCutoverPolicyError);
}
