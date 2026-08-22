import type {
  HybridSearchInput,
  EmbeddingResponse,
  ReplaceRetrievalChunks,
  ReplaceRetrievalChunksOutcome,
  RetrievalHit,
  RetrievalSourceReference,
  RetrievalSourceSnapshot,
  ResolveRetrievalEmbedding,
  CaptureLearningRetrievalContext,
  LearningRetrievalContextSnapshot,
} from './retrieval.types';

export const RETRIEVAL_REPOSITORY = Symbol('RETRIEVAL_REPOSITORY');

export type RemoveMissingSourceChunksOutcome = 'removed' | 'superseded';

export type PruneEmbeddingCacheInput = {
  retentionDays: number;
  batchSize: number;
};

export interface RetrievalRepository {
  captureLearningContext(
    input: CaptureLearningRetrievalContext,
  ): Promise<LearningRetrievalContextSnapshot>;
  readSourceSnapshot(
    source: RetrievalSourceReference,
  ): Promise<RetrievalSourceSnapshot | null>;
  resolveEmbedding(
    input: ResolveRetrievalEmbedding,
    load: () => Promise<EmbeddingResponse>,
  ): Promise<EmbeddingResponse>;
  pruneEmbeddingCache(input: PruneEmbeddingCacheInput): Promise<number>;
  replaceSourceChunks(
    input: ReplaceRetrievalChunks,
  ): Promise<ReplaceRetrievalChunksOutcome>;
  removeMissingSourceChunks(
    source: RetrievalSourceReference,
  ): Promise<RemoveMissingSourceChunksOutcome>;
  hybridSearch(input: HybridSearchInput): Promise<RetrievalHit[]>;
}
