export type CourseStatus = 'draft' | 'published' | 'archived';
export type CourseVisibility = 'private' | 'public';
export type CourseCursorKind = 'owner' | 'public';

export type CourseStepSnapshot = {
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
};

export type CourseLearningMark = {
  id: string;
  start: number;
  end: number;
  note: string;
  caption: string;
  createdAt: string;
};

export type CourseLoopState = {
  enabled: boolean;
  manual: boolean;
  start: number;
  end: number;
};

export type OwnerLearningState = {
  captionLanguage: 'ko' | 'en';
  captionsEnabled: boolean;
  playbackRate: 0.75 | 1 | 1.25 | 1.5 | 2;
  loop: CourseLoopState;
  marks: CourseLearningMark[];
};

export type CourseStep = {
  id: string;
  courseId: number;
  sourcePostId: number | null;
  position: number;
  snapshot: CourseStepSnapshot;
  ownerLearningState: OwnerLearningState;
};

export type CourseFeedback = {
  id: number;
  courseId: number;
  authorId: number;
  authorName: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type CourseAggregate = {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  visibility: CourseVisibility;
  status: CourseStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  steps: CourseStep[];
  feedback: CourseFeedback[];
};

export type ExistingCourseStepInput = {
  stepId: string;
  sourcePostId?: never;
  snapshot?: never;
  ownerLearningState?: never;
};

export type SourcePostCourseStepInput = {
  stepId?: never;
  sourcePostId: number;
  snapshot?: never;
  ownerLearningState?: OwnerLearningState;
};

export type SnapshotCourseStepInput = {
  stepId?: never;
  sourcePostId?: never;
  snapshot: CourseStepSnapshot;
  ownerLearningState?: OwnerLearningState;
};

export type CourseStepInput =
  | ExistingCourseStepInput
  | SourcePostCourseStepInput
  | SnapshotCourseStepInput;

export type CreateCourseInput = {
  title: string;
  description: string;
  steps: Exclude<CourseStepInput, ExistingCourseStepInput>[];
};

export type UpdateCourseMetadataInput = {
  title?: string;
  description?: string;
  expectedVersion: number;
};

export type ReplaceCourseStepsInput = {
  expectedVersion: number;
  steps: CourseStepInput[];
};

export type CourseVersionInput = {
  expectedVersion: number;
};

export type CreateCourseFeedbackInput = {
  rating: number;
  body: string;
};

export type OwnerCourseStepProjection = Omit<CourseStep, 'courseId'>;
export type OwnerCourseFeedbackProjection = Omit<CourseFeedback, 'courseId'>;

export type OwnerCourseProjection = Omit<
  CourseAggregate,
  'steps' | 'feedback'
> & {
  steps: OwnerCourseStepProjection[];
  feedback: OwnerCourseFeedbackProjection[];
};

export type PublicCourseStepProjection = {
  id: string;
  position: number;
  snapshot: CourseStepSnapshot;
};

export type PublicCourseFeedbackProjection = {
  id: number;
  authorName: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type PublicCourseProjection = {
  id: number;
  title: string;
  description: string;
  visibility: 'public';
  status: 'published';
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  steps: PublicCourseStepProjection[];
  feedback: PublicCourseFeedbackProjection[];
};

export type CourseCursor = {
  version: 1;
  kind: CourseCursorKind;
  timestamp: string;
  id: number;
};

export type CoursePage<T> = {
  items: T[];
  nextCursor: string | null;
};
