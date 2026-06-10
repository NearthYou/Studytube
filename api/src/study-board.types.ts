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

export type BoardRepository = {
  createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<User>;
  findUserByEmail(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null>;
  updateUser(
    id: number,
    input: {
      name?: string;
      passwordHash?: string;
    },
  ): Promise<User | null>;
  createSession(userId: number, token: string): Promise<Session>;
  findSession(token: string): Promise<Session | null>;
  listPosts(input: {
    authorId?: number;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedPosts>;
  findPost(id: number): Promise<StudyPost | null>;
  createPost(input: CreatePostInput): Promise<StudyPost>;
  updatePost(id: number, input: UpdatePostInput): Promise<StudyPost | null>;
  deletePost(id: number): Promise<boolean>;
  addComment(input: {
    postId: number;
    authorId: number;
    body: string;
  }): Promise<Comment>;
  listPlaylists(ownerId?: number): Promise<Playlist[]>;
  createPlaylist(input: {
    ownerId: number;
    title: string;
    description: string;
    postIds: number[];
  }): Promise<Playlist>;
  addPlaylistItem(playlistId: number, postId: number): Promise<Playlist | null>;
  addPlaylistFeedback(input: {
    playlistId: number;
    authorId: number;
    rating: number;
    body: string;
  }): Promise<PlaylistFeedback>;
};
