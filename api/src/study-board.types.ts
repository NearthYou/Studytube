import type {
  CreateVideoAssetInput,
  UpdateVideoAssetInput,
  VideoAsset,
} from './video-asset.types';

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

export type Comment = {
  id: number;
  postId: number;
  authorId: number;
  authorName: string;
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

export type PlaylistFeedback = {
  id: number;
  playlistId: number;
  authorId: number;
  authorName: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type PaginatedPosts = {
  items: StudyPost[];
  total: number;
  page: number;
  pageSize: number;
};

export type CreatePostInput = {
  authorId: number;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  channelName?: string;
  summary: string;
  translatedNotes: string;
  tags: string[];
};

export type UpdatePostInput = Partial<Omit<CreatePostInput, 'authorId'>>;

export type UpdatePlaylistInput = {
  title?: string;
  description?: string;
  postIds?: number[];
};

export type BoardRepository = {
  withCourseWriterSharedLease?<T>(operation: () => Promise<T>): Promise<T>;
  listPosts(input: {
    authorId?: number;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedPosts>;
  findPost(id: number): Promise<StudyPost | null>;
  createPost(input: CreatePostInput): Promise<StudyPost>;
  updatePost(id: number, input: UpdatePostInput): Promise<StudyPost | null>;
  hasCompletedCourseBackfillAuditForPost(postId: number): Promise<boolean>;
  deletePost(id: number): Promise<boolean>;
  findVideoAsset(postId: number): Promise<VideoAsset | null>;
  upsertVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset>;
  updateVideoAsset(
    postId: number,
    input: UpdateVideoAssetInput,
  ): Promise<VideoAsset | null>;
  addComment(input: {
    postId: number;
    authorId: number;
    body: string;
  }): Promise<Comment>;
  deleteComment(postId: number, commentId: number): Promise<boolean>;
  listPlaylists(ownerId?: number): Promise<Playlist[]>;
  createPlaylist(input: {
    ownerId: number;
    title: string;
    description: string;
    postIds: number[];
  }): Promise<Playlist>;
  updatePlaylist(
    id: number,
    input: UpdatePlaylistInput,
  ): Promise<Playlist | null>;
  deletePlaylist(id: number): Promise<boolean>;
  addPlaylistItem(playlistId: number, postId: number): Promise<Playlist | null>;
  addPlaylistFeedback(input: {
    playlistId: number;
    authorId: number;
    rating: number;
    body: string;
  }): Promise<PlaylistFeedback>;
};
