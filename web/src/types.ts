export type User = {
  id: number;
  name: string;
  email: string;
  createdAt: string;
};

export type Session = {
  token: string;
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
