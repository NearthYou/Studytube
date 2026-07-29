import type {
  AgentBudgets,
  AgentUsage,
  ProposedCourseStep,
  WatchedRange,
} from './learning.types';

export function mergeWatchedRanges(
  existing: WatchedRange[],
  incoming: WatchedRange,
  durationSeconds: number,
): { ranges: WatchedRange[]; coverage: number } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError('Step duration must be positive');
  }
  const start = Math.max(0, Math.min(durationSeconds, incoming.start));
  const end = Math.max(0, Math.min(durationSeconds, incoming.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RangeError('Watched range must have a positive duration');
  }
  const candidates = [...existing, { start, end }]
    .map((range) => ({
      start: Math.max(0, Math.min(durationSeconds, range.start)),
      end: Math.max(0, Math.min(durationSeconds, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const ranges: WatchedRange[] = [];
  for (const candidate of candidates) {
    const previous = ranges.at(-1);
    if (!previous || candidate.start > previous.end) {
      ranges.push({ ...candidate });
    } else {
      previous.end = Math.max(previous.end, candidate.end);
    }
  }
  const watchedSeconds = ranges.reduce(
    (total, range) => total + range.end - range.start,
    0,
  );
  return { ranges, coverage: watchedSeconds / durationSeconds };
}

export function shouldCompleteLearning(
  watchedCoverage: number,
  bestQuizScore: number | null,
): boolean {
  return watchedCoverage >= 0.8 && (bestQuizScore ?? -1) >= 70;
}

export function validateAgentUsage(
  usage: AgentUsage,
  budgets: AgentBudgets,
  elapsedMs = 0,
): void {
  validateRecordedAgentUsage(usage);
  if (
    usage.toolCalls > budgets.toolCallBudget ||
    usage.tokens > budgets.tokenBudget ||
    usage.estimatedCostUsd > budgets.estimatedCostBudgetUsd
  ) {
    throw new RangeError('Agent usage exceeds its fixed budget');
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('Agent wall time must be non-negative');
  }
  if (elapsedMs > budgets.wallTimeBudgetMs) {
    throw new RangeError('Agent wall time exceeds its fixed budget');
  }
}

export function validateRecordedAgentUsage(usage: AgentUsage): void {
  if (
    !Number.isInteger(usage.toolCalls) ||
    !Number.isInteger(usage.tokens) ||
    !Number.isFinite(usage.estimatedCostUsd) ||
    usage.toolCalls < 0 ||
    usage.tokens < 0 ||
    usage.estimatedCostUsd < 0
  ) {
    throw new RangeError('Agent usage must be non-negative');
  }
}

export function validateProposedSteps(steps: ProposedCourseStep[]): void {
  if (steps.length < 3 || steps.length > 6) {
    throw new RangeError(
      'A proposed course must contain between 3 and 6 steps',
    );
  }
  for (const [index, step] of steps.entries()) {
    if (step.position !== index + 1) {
      throw new RangeError('Proposed step positions must be contiguous');
    }
    if (step.status === 'needs_replacement') {
      throw new RangeError('A proposed step needs replacement');
    }
    if (
      !allowedYoutubeUrl(step.videoUrl) ||
      !allowedYoutubeUrl(step.evidenceSourceUrl) ||
      !Number.isInteger(step.evidenceTimestampSeconds) ||
      step.evidenceTimestampSeconds < 0 ||
      !Number.isFinite(step.evidenceConfidence) ||
      step.evidenceConfidence < 0 ||
      step.evidenceConfidence > 1 ||
      !Number.isInteger(step.durationSeconds) ||
      step.durationSeconds <= 0
    ) {
      throw new RangeError(
        'Every proposed step requires valid YouTube citation evidence',
      );
    }
  }
}

function allowedYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(
        url.hostname.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}
