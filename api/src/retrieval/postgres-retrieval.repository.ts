import type { Pool } from 'pg';
import type {
  PruneEmbeddingCacheInput,
  RemoveMissingSourceChunksOutcome,
  RetrievalRepository,
} from './retrieval.repository';
import type {
  EmbeddingResponse,
  HybridSearchInput,
  ReplaceRetrievalChunks,
  ReplaceRetrievalChunksOutcome,
  ResolveRetrievalEmbedding,
  RetrievalHit,
  RetrievalSearchMode,
  RetrievalSourceReference,
  RetrievalSourceSnapshot,
} from './retrieval.types';
import { PostgresRetrievalEmbeddingCache } from './postgres-retrieval-embedding-cache';
import { PostgresRetrievalSearch } from './postgres-retrieval-search';
import { PostgresRetrievalSourcePersistence } from './postgres-retrieval-source.persistence';

export { RetrievalSourceInvariantError } from './retrieval.errors';

export class PostgresRetrievalRepository implements RetrievalRepository {
  private readonly sources: PostgresRetrievalSourcePersistence;
  private readonly embeddingCache: PostgresRetrievalEmbeddingCache;
  private readonly retrievalSearch: PostgresRetrievalSearch;

  constructor(pool: Pool) {
    this.sources = new PostgresRetrievalSourcePersistence(pool);
    this.embeddingCache = new PostgresRetrievalEmbeddingCache(pool);
    this.retrievalSearch = new PostgresRetrievalSearch(pool);
  }

  readSourceSnapshot(
    source: RetrievalSourceReference,
  ): Promise<RetrievalSourceSnapshot | null> {
    return this.sources.readSnapshot(source);
  }

  resolveEmbedding(
    input: ResolveRetrievalEmbedding,
    load: () => Promise<EmbeddingResponse>,
  ): Promise<EmbeddingResponse> {
    return this.embeddingCache.resolve(input, load);
  }

  pruneEmbeddingCache(input: PruneEmbeddingCacheInput): Promise<number> {
    return this.embeddingCache.prune(input);
  }

  replaceSourceChunks(
    input: ReplaceRetrievalChunks,
  ): Promise<ReplaceRetrievalChunksOutcome> {
    return this.sources.replaceChunks(input);
  }

  removeMissingSourceChunks(
    source: RetrievalSourceReference,
  ): Promise<RemoveMissingSourceChunksOutcome> {
    return this.sources.removeMissingChunks(source);
  }

  hybridSearch(input: HybridSearchInput): Promise<RetrievalHit[]> {
    return this.retrievalSearch.hybrid(input);
  }

  search(
    input: HybridSearchInput,
    mode: RetrievalSearchMode,
  ): Promise<RetrievalHit[]> {
    return this.retrievalSearch.search(input, mode);
  }
}
