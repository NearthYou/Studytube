export type RetrievalSourceKind = 'post' | 'course_step';
export type RetrievalVisibility = 'private' | 'public';
export type RetrievalSearchMode = 'lexical' | 'vector' | 'hybrid';

export type EmbeddingResponse = {
  model: string;
  dimensions: 1536;
  embedding: number[];
  cacheHit?: boolean;
  inputTokens?: number;
  estimatedCostUsd?: number;
};

export type RetrievalSourceReference = {
  sourceKind: RetrievalSourceKind;
  sourceId: string | number;
};

export type RetrievalTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type RetrievalSourceSnapshot = {
  sourceKind: RetrievalSourceKind;
  sourceId: string;
  sourceVersion: string;
  ownerId: number;
  visibility: RetrievalVisibility;
  title: string;
  summary: string;
  translatedNotes: string;
  tags: string[];
  sourceUrl: string;
  transcriptBody: string;
  sourceSegments: RetrievalTranscriptSegment[];
  translatedSegments: RetrievalTranscriptSegment[];
};

export type RetrievalChunk = {
  chunkIndex: number;
  content: string;
  startSeconds: number | null;
  endSeconds: number | null;
  sourceUrl: string;
  embedding: number[];
};

export type ReplaceRetrievalChunks = {
  sourceKind: RetrievalSourceKind;
  sourceId: string | number;
  sourceVersion: string | number;
  ownerId: number;
  visibility: RetrievalVisibility;
  model: string;
  chunks: RetrievalChunk[];
};

export type ReplaceRetrievalChunksOutcome = 'stored' | 'superseded';

export type ResolveRetrievalEmbedding = {
  model: string;
  content: string;
};

export type HybridSearchInput = {
  ownerId: number;
  query: string;
  model: string;
  embedding: number[];
  limit: number;
};

export type RetrievalHit = {
  sourceKind: RetrievalSourceKind;
  sourceId: string;
  visibility: RetrievalVisibility;
  title: string;
  content: string;
  score: number;
  citation: {
    sourceUrl: string;
    timestampSeconds: number | null;
  };
};
