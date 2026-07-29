import {
  assertQueryPlanContract,
  extractExplainPlan,
  QUERY_PLAN_VERIFICATION_SESSION_SETTINGS,
  type ExplainPlan,
} from './database-query-plan';

describe('database query plan contracts', () => {
  it('makes synthetic index-availability checks independent of planner cost sampling', () => {
    expect(QUERY_PLAN_VERIFICATION_SESSION_SETTINGS).toContain(
      'SET LOCAL enable_seqscan = off',
    );
  });

  it('accepts the required index without a protected sequential scan', () => {
    const plan: ExplainPlan = {
      'Node Type': 'Nested Loop',
      Plans: [
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'users',
          'Index Name': 'users_email_canonical_key',
        },
      ],
    };

    expect(() =>
      assertQueryPlanContract('auth lookup', plan, {
        requiredIndexes: [/^users_email_canonical_key$/u],
        forbiddenSequentialScanRelations: ['users'],
      }),
    ).not.toThrow();
  });

  it('reports a missing access path and every protected sequential scan', () => {
    const plan: ExplainPlan = {
      'Node Type': 'Append',
      Plans: [
        { 'Node Type': 'Seq Scan', 'Relation Name': 'courses' },
        { 'Node Type': 'Seq Scan', 'Relation Name': 'course_steps' },
      ],
    };

    expect(() =>
      assertQueryPlanContract('course detail', plan, {
        requiredIndexes: [/courses_pkey/u, /course_steps_course_position_key/u],
        forbiddenSequentialScanRelations: ['courses', 'course_steps'],
      }),
    ).toThrow(
      'course detail query plan contract failed: missing index /courses_pkey/u; missing index /course_steps_course_position_key/u; sequential scan on courses; sequential scan on course_steps',
    );
  });

  it('extracts the root plan returned by PostgreSQL JSON EXPLAIN', () => {
    expect(
      extractExplainPlan([{ Plan: { 'Node Type': 'Index Scan' } }]),
    ).toEqual({ 'Node Type': 'Index Scan' });
    expect(() => extractExplainPlan([{ Planning: {} }])).toThrow(
      'PostgreSQL returned an invalid JSON query plan',
    );
  });
});
