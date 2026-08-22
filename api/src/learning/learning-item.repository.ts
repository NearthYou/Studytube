import type {
  LearningContext,
  LearningCaptionSnapshot,
  LearningContextProvenance,
  VideoProvider,
} from './learning-item.types';

export const LEARNING_ITEM_REPOSITORY = Symbol('LEARNING_ITEM_REPOSITORY');

export type EnsureLearningContextCommand = {
  userId: number;
  provider: VideoProvider;
  canonicalVideoId: string;
  canonicalUrl: string;
  sourcePostId: number | null;
  courseStepId: string | null;
  provenance: LearningContextProvenance;
};

export interface LearningItemRepository {
  ensureContext(
    command: EnsureLearningContextCommand,
  ): Promise<LearningContext>;
  findOwnerContext(
    userId: number,
    contextId: string,
  ): Promise<LearningContext | null>;
  findOwnerCaptionSnapshot(
    userId: number,
    contextId: string,
  ): Promise<LearningCaptionSnapshot | null>;
}
