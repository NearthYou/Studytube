export type RetrievalSourceKind = 'post' | 'course_step' | 'learning_context';
export type RetrievalVisibility = 'private' | 'public';
export type RetrievalSearchMode = 'lexical' | 'vector' | 'hybrid';
export type LearningEvidenceKind =
  | 'caption_segment'
  | 'learning_note'
  | 'quiz_outcome';
export type RetrievalReadiness = 'partial' | 'ready';

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

export type LearningEvidenceItem = {
  kind: LearningEvidenceKind;
  resourceId: string;
  content: string;
  startSeconds: number;
  endSeconds: number;
  sourceUrl: string;
  readiness: RetrievalReadiness;
  artifactId?: string;
  segmentId?: string;
  noteId?: string;
  quizAttemptId?: string;
  artifactGeneration: number;
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
  evidenceItems?: LearningEvidenceItem[];
};

export type RetrievalChunk = {
  chunkIndex: number;
  content: string;
  startSeconds: number | null;
  endSeconds: number | null;
  sourceUrl: string;
  embedding: number[];
  resourceId?: string;
  readiness?: RetrievalReadiness;
  evidenceKind?: LearningEvidenceKind;
  evidenceArtifactId?: string;
  evidenceSegmentId?: string;
  evidenceNoteId?: string;
  evidenceQuizAttemptId?: string;
  artifactGeneration?: number;
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
  contextSnapshotId?: string;
};

export type RetrievalHit = {
  sourceKind: RetrievalSourceKind;
  sourceId: string;
  visibility: RetrievalVisibility;
  title: string;
  content: string;
  score: number;
  resourceId?: string;
  readiness?: RetrievalReadiness;
  artifactGeneration?: number;
  citation: {
    sourceUrl: string;
    timestampSeconds: number | null;
    endSeconds?: number | null;
  };
};

export type CaptureLearningRetrievalContext = {
  agentRunId: string;
  ownerId: number;
  studyContextId: string | number;
  watchedRanges: ReadonlyArray<{ start: number; end: number }>;
};

export type LearningRetrievalContextSnapshot = {
  agentRunId: string;
  ownerId: number;
  studyContextId: string;
  learningItemId: string;
  videoSourceId: string;
  courseId: number | null;
  profileGoal: string;
  watchedRanges: Array<{ start: number; end: number }>;
  captionArtifactId: string;
  captionGeneration: number;
  contextRetrievalVersion: string;
};
