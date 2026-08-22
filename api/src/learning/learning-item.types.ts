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
