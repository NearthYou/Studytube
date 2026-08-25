export type User = {
  id: number;
  name: string;
  email: string;
  preferences: LearningPreferences;
  createdAt: string;
};

export type LearningPreferences = {
  interests: string[];
  pace: string;
  goal: string;
};

export type Session = {
  user: User;
};

export type Comment = {
  id: number;
  postId: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type StudyPost = {
  id: number;
  authorId: number;
  authorName: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  tags: string[];
  comments: Comment[];
  createdAt: string;
  updatedAt: string;
};

export type PaginatedPosts = {
  items: StudyPost[];
  total: number;
  page: number;
  pageSize: number;
};

export type PlaylistFeedback = {
  id: number;
  playlistId: number;
  authorId: number;
  authorName: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type Playlist = {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  postIds: number[];
  feedback: PlaylistFeedback[];
  createdAt: string;
};

export type CourseStatus = 'draft' | 'published' | 'archived';

export type CourseVisibility = 'private' | 'public';

export type CourseSnapshot = {
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

export type CourseLearningState = {
  captionLanguage: 'ko' | 'en';
  captionsEnabled: boolean;
  playbackRate: 0.75 | 1 | 1.25 | 1.5 | 2;
  loop: {
    enabled: boolean;
    manual: boolean;
    start: number;
    end: number;
  };
  marks: CourseLearningMark[];
};

export type CourseStep = {
  id: string;
  position: number;
  sourcePostId?: number | null;
  snapshot: CourseSnapshot;
  ownerLearningState?: CourseLearningState;
};

export type CourseFeedback = {
  id: number;
  authorName: string;
  authorId?: number;
  rating: number;
  body: string;
  createdAt: string;
};

export type Course = {
  id: number;
  ownerId?: number;
  title: string;
  description: string;
  visibility: CourseVisibility;
  status: CourseStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt?: string | null;
  steps: CourseStep[];
  feedback: CourseFeedback[];
};

export type CoursePage<TCourse extends Course = Course> = {
  items: TCourse[];
  nextCursor: string | null;
};

export type NewCourseStep =
  | {
      sourcePostId: number;
      snapshot?: never;
      ownerLearningState?: CourseLearningState;
    }
  | {
      sourcePostId?: never;
      snapshot: CourseSnapshot;
      ownerLearningState?: CourseLearningState;
    };

export type CourseStepMutation =
  | { stepId: string }
  | NewCourseStep;

export type CreateCourseInput = {
  title: string;
  description: string;
  steps: NewCourseStep[];
};

export type RagResponse = {
  mode: string;
  query: string;
  answer: string;
  relatedPosts: Array<
    Pick<
      StudyPost,
      | 'id'
      | 'title'
      | 'videoUrl'
      | 'thumbnailUrl'
      | 'channelName'
      | 'summary'
      | 'translatedNotes'
      | 'tags'
    > & {
      score: number;
      evidenceSource?: string;
      evidenceSnippet?: string;
    }
  >;
  embedding?: {
    provider: string;
    dimensions: number;
    vectorDb: string;
  };
};

export type McpResponse = {
  jsonrpc: '2.0';
  id: string;
  result?: {
    provider: string;
    title: string;
    channel: string;
    thumbnailUrl: string;
    sourceUrl: string;
    durationLabel: string;
    summary: string;
    videos: Array<{
      provider: string;
      videoId?: string | null;
      title: string;
      channel: string;
      thumbnailUrl: string;
      sourceUrl: string;
      durationLabel: string;
      summary: string;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
};

export type AgentResponse = {
  mode: string;
  goal: string;
  playlistTitle: string;
  recommendations: Array<{
    title: string;
    url: string;
    thumbnailUrl: string;
    source: string;
    why: string;
  }>;
  suggestedTags: string[];
  rationale: string;
  trace: Array<{
    iteration: number;
    tool: string;
    reason: string;
    error?: string;
  }>;
  guardrails?: {
    maxIterations: number;
    loopStopped: boolean;
    orchestration?: "langgraph";
    toolCalling: string;
  };
};

export type CaptionSegment = {
  start: number;
  end: number;
  text: string;
};

export type CaptionResponse = {
  mode: string;
  provider: string;
  videoId: string;
  language: string;
  sourceLanguage: string;
  translated: boolean;
  segments: CaptionSegment[];
  message: string;
};

export type LearningNote = {
  id: string;
  userId: number;
  studyContextId: string;
  positionSeconds: number;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type LearningCaptionSnapshotResponse = {
  contextId: string;
  generation: number;
  phase:
    | "source_pending"
    | "transcription_pending"
    | "translation_pending"
    | "index_pending"
    | "partial"
    | "failed"
    | "complete";
  sourceLanguage: string;
  sourceSegments: CaptionSegment[];
  koreanSegments: CaptionSegment[];
  stale: boolean;
  errorCode?: string;
};

export type LearningOverviewResponse = {
  contextId: string;
  status: "pending" | "ready" | "failed";
  coverage: {
    scope: "full_video" | "study_range";
    startSeconds: number;
    endSeconds: number;
  };
  summary?: {
    overview: string;
    chapters: Array<{
      startSeconds: number;
      endSeconds: number;
      title: string;
      body: string;
    }>;
    takeaways: string[];
  };
  errorCode?: string;
};

export type SegmentExplanationResponse = {
  plainMeaning: string;
  keyExpressions: Array<{ text: string; meaning: string }>;
  contextNote: string;
  citation: { startSeconds: number; endSeconds: number };
};

export type VideoSummarySection = {
  label: string;
  body: string;
};

export type VideoSummaryResponse = {
  mode: string;
  provider: string;
  videoId: string;
  language: string;
  sections: VideoSummarySection[];
  message: string;
};
