export type VideoProvider = 'youtube';

export type LearningContextProvenance = Record<string, unknown>;

export type VideoSource = {
  id: string;
  provider: VideoProvider;
  canonicalVideoId: string;
  canonicalUrl: string;
};

export type LearningItem = {
  id: string;
  userId: number;
  videoSourceId: string;
  sourcePostId: number | null;
  provenance: LearningContextProvenance;
};

export type StudyContext = {
  id: string;
  userId: number;
  learningItemId: string;
  kind: 'standalone' | 'course_occurrence';
  courseStepId: string | null;
  courseStepProvenanceId: string | null;
  provenance: LearningContextProvenance;
};

export type LearningContext = {
  videoSource: VideoSource;
  learningItem: LearningItem;
  studyContext: StudyContext;
};

export type LearningCaptionPhase =
  | 'source_pending'
  | 'transcription_pending'
  | 'translation_pending'
  | 'index_pending'
  | 'partial'
  | 'failed'
  | 'complete';

export type LearningCaptionSegment = Readonly<{
  start: number;
  end: number;
  text: string;
}>;

export type LearningCaptionSnapshot = Readonly<{
  contextId: string;
  generation: number;
  phase: LearningCaptionPhase;
  sourceLanguage: string;
  sourceSegments: LearningCaptionSegment[];
  koreanSegments: LearningCaptionSegment[];
  stale: boolean;
  errorCode?: string;
}>;
