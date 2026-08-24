import { Inject, Injectable } from '@nestjs/common';
import { AiProxyService } from '../ai-proxy.service';
import {
  LEARNING_OVERVIEW_REPOSITORY,
  type LearningOverviewRepository,
} from './learning-overview.repository';

@Injectable()
export class LearningOverviewService {
  constructor(
    @Inject(LEARNING_OVERVIEW_REPOSITORY)
    private readonly repository: LearningOverviewRepository,
    private readonly ai: AiProxyService,
  ) {}

  getOverview(userId: number, contextId: string) {
    return this.repository.requestOwnerOverview(userId, contextId);
  }

  async explainSegment(
    userId: number,
    contextId: string,
    input: { startSeconds: number; endSeconds: number },
  ) {
    if (input.endSeconds <= input.startSeconds) {
      throw new InvalidLearningSegmentRangeError();
    }
    const segment = await this.repository.findOwnerSegment(
      userId,
      contextId,
      input.startSeconds,
      input.endSeconds,
    );
    if (!segment) return null;
    const response = await this.ai.explainLearningSegment(segment);
    if (!isExplanation(response)) {
      throw new LearningExplanationUnavailableError();
    }
    return {
      plainMeaning: response.plainMeaning.trim(),
      keyExpressions: response.keyExpressions.slice(0, 4).map((item) => ({
        text: item.text.trim(),
        meaning: item.meaning.trim(),
      })),
      contextNote: response.contextNote.trim(),
      citation: {
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
      },
    };
  }
}

export class InvalidLearningSegmentRangeError extends Error {
  readonly code = 'INVALID_LEARNING_SEGMENT_RANGE';
}

export class LearningExplanationUnavailableError extends Error {
  readonly code = 'LEARNING_EXPLANATION_UNAVAILABLE';
}

function isExplanation(value: unknown): value is {
  plainMeaning: string;
  keyExpressions: Array<{ text: string; meaning: string }>;
  contextNote: string;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.plainMeaning === 'string' &&
    candidate.plainMeaning.trim().length > 0 &&
    typeof candidate.contextNote === 'string' &&
    Array.isArray(candidate.keyExpressions) &&
    candidate.keyExpressions.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).text === 'string' &&
        typeof (item as Record<string, unknown>).meaning === 'string',
    )
  );
}
