import {
  mergeWatchedRanges,
  shouldCompleteLearning,
  validateAgentUsage,
  validateRecordedAgentUsage,
  validateProposedSteps,
} from './learning.domain';

describe('learning domain invariants', () => {
  it('merges overlapping, adjacent, duplicate, and out-of-order watched ranges without inflating coverage', () => {
    const merged = mergeWatchedRanges(
      [
        { start: 20, end: 40 },
        { start: 0, end: 10 },
      ],
      { start: 8, end: 25 },
      100,
    );

    expect(merged).toEqual({
      ranges: [{ start: 0, end: 40 }],
      coverage: 0.4,
    });
    expect(
      mergeWatchedRanges(merged.ranges, { start: 8, end: 25 }, 100),
    ).toEqual(merged);
  });

  it('clips ranges to the trusted step duration before calculating coverage', () => {
    expect(mergeWatchedRanges([], { start: 90, end: 130 }, 100)).toEqual({
      ranges: [{ start: 90, end: 100 }],
      coverage: 0.1,
    });
  });

  it('requires both 80 percent coverage and a 70 percent quiz score', () => {
    expect(shouldCompleteLearning(0.8, 70)).toBe(true);
    expect(shouldCompleteLearning(0.799_999, 100)).toBe(false);
    expect(shouldCompleteLearning(1, 69.99)).toBe(false);
    expect(shouldCompleteLearning(1, null)).toBe(false);
  });

  it('blocks successful completion when recorded usage exceeds a fixed run budget', () => {
    const budgets = {
      wallTimeBudgetMs: 120_000,
      toolCallBudget: 8,
      tokenBudget: 12_000,
      estimatedCostBudgetUsd: 0.2,
    };
    expect(() =>
      validateAgentUsage(
        { toolCalls: 8, tokens: 12_000, estimatedCostUsd: 0.2 },
        budgets,
      ),
    ).not.toThrow();
    expect(() =>
      validateAgentUsage(
        { toolCalls: 9, tokens: 12_000, estimatedCostUsd: 0.2 },
        budgets,
      ),
    ).toThrow('budget');
    expect(() =>
      validateAgentUsage(
        { toolCalls: 1, tokens: -1, estimatedCostUsd: 0 },
        budgets,
      ),
    ).toThrow('non-negative');
    expect(() =>
      validateAgentUsage(
        { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
        budgets,
        120_001,
      ),
    ).toThrow('wall time');
  });

  it('allows a failed run to record the measured overage without accepting negative usage', () => {
    expect(() =>
      validateRecordedAgentUsage({
        toolCalls: 101,
        tokens: 1_000_001,
        estimatedCostUsd: 1.5,
      }),
    ).not.toThrow();
    expect(() =>
      validateRecordedAgentUsage({
        toolCalls: -1,
        tokens: 0,
        estimatedCostUsd: 0,
      }),
    ).toThrow('non-negative');
  });

  it('accepts three through six ready steps with complete citation evidence', () => {
    expect(() =>
      validateProposedSteps([step(1, 0.91), step(2, 0.82), step(3, 0.73)]),
    ).not.toThrow();
  });

  it('refuses approval when any proposed step needs replacement', () => {
    expect(() =>
      validateProposedSteps([
        step(1, 0.91),
        { ...step(2, 0.2), status: 'needs_replacement' },
        step(3, 0.73),
      ]),
    ).toThrow('needs replacement');
  });

  it('refuses proposed steps whose video or citation cannot drive grounded YouTube work', () => {
    expect(() =>
      validateProposedSteps([
        step(1, 0.91),
        {
          ...step(2, 0.82),
          evidenceSourceUrl: 'https://video.example.test/not-youtube',
        },
        step(3, 0.73),
      ]),
    ).toThrow('YouTube');
    expect(() =>
      validateProposedSteps([
        step(1, 0.91),
        {
          ...step(2, 0.82),
          videoUrl: 'http://www.youtube.com/watch?v=insecure',
        },
        step(3, 0.73),
      ]),
    ).toThrow('YouTube');
  });

  it('refuses approval outside the three through six step boundary', () => {
    expect(() => validateProposedSteps([step(1, 0.9), step(2, 0.8)])).toThrow(
      'between 3 and 6',
    );
  });
});

function step(position: number, confidence: number) {
  return {
    position,
    title: `Step ${position}`,
    videoUrl: `https://www.youtube.com/watch?v=video${position}`,
    thumbnailUrl: '',
    channelName: 'StudyTube Lab',
    sourcePostId: null,
    evidenceSourceUrl: `https://www.youtube.com/watch?v=video${position}&t=${position * 10}s`,
    evidenceTimestampSeconds: position * 10,
    evidenceConfidence: confidence,
    status: 'ready' as const,
    durationSeconds: 100,
  };
}
