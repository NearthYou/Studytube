import type { LearningCaptionSegment } from './learning-item.types';

export const LEARNING_OVERVIEW_REPOSITORY = Symbol(
  'LEARNING_OVERVIEW_REPOSITORY',
);

export type LearningOverviewCoverage = {
  scope: 'full_video' | 'study_range';
  startSeconds: number;
  endSeconds: number;
};

export type LearningOverviewSummary = {
  overview: string;
  chapters: Array<{
    startSeconds: number;
    endSeconds: number;
    title: string;
    body: string;
  }>;
  takeaways: string[];
};

export type LearningOverviewSnapshot = {
  contextId: string;
  status: 'pending' | 'ready' | 'failed';
  coverage: LearningOverviewCoverage;
  summary?: LearningOverviewSummary;
  errorCode?: string;
};

export type LearningOverviewGeneration = {
  summaryId: string;
  contextId: string;
  status: 'pending' | 'ready' | 'failed';
  videoId: string;
  captionArtifactId: string;
  captionGeneration: number;
  coverage: LearningOverviewCoverage;
  segments: LearningCaptionSegment[];
};

export type LearningSegmentContext = {
  contextId: string;
  sourceLanguage: string;
  source: string;
  korean: string;
  startSeconds: number;
  endSeconds: number;
};

export interface LearningOverviewRepository {
  requestOwnerOverview(
    userId: number,
    contextId: string,
  ): Promise<LearningOverviewSnapshot | null>;
  loadGeneration(summaryId: string): Promise<LearningOverviewGeneration | null>;
  completeGeneration(
    summaryId: string,
    summary: LearningOverviewSummary,
  ): Promise<boolean>;
  failGeneration(summaryId: string, errorCode: string): Promise<boolean>;
  findOwnerSegment(
    userId: number,
    contextId: string,
    startSeconds: number,
    endSeconds: number,
  ): Promise<LearningSegmentContext | null>;
}
