import { createHash } from 'node:crypto';
import {
  BoardRepository,
  Comment,
  CreatePostInput,
  LearningPreferences,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  Session,
  StudyPost,
  UpdatePostInput,
  User,
} from './study-board.types';

type StoredUser = User & { passwordHash: string };

const nowIso = () => new Date().toISOString();

const demoPasswordHash = createHash('sha256').update('demo1234').digest('hex');
const defaultPreferences = (): LearningPreferences => ({
  interests: ['YouTube 학습', '프론트엔드'],
  pace: '하루 20분',
  goal: '짧은 영상으로 꾸준히 복습하기',
});

export class MemoryBoardRepository implements BoardRepository {
  protected users: StoredUser[] = [
    {
      id: 1,
      name: 'Demo Learner',
      email: 'demo@studytube.local',
      passwordHash: demoPasswordHash,
      preferences: defaultPreferences(),
      createdAt: nowIso(),
    },
  ];

  protected sessions: { token: string; userId: number }[] = [];

  protected posts: StudyPost[] = [
    {
      id: 1,
      authorId: 1,
      authorName: 'Demo Learner',
      title: 'React Hooks Course - All React Hooks Explained',
      videoUrl: 'https://www.youtube.com/watch?v=LlvBzyy-558',
      thumbnailUrl: 'https://i.ytimg.com/vi/LlvBzyy-558/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A practical React hooks lesson covering useState, useEffect, useMemo, useCallback, and custom hooks through small examples.',
      translatedNotes:
        'useState, useEffect, useMemo, useCallback, 커스텀 훅을 작은 예제로 익히는 React 훅 실습 영상입니다.',
      tags: ['react', 'frontend', 'hooks'],
      comments: [
        {
          id: 1,
          postId: 1,
          authorId: 1,
          authorName: 'Demo Learner',
          body: 'useEffect dependency 설명이 입문자에게 특히 좋아요.',
          createdAt: nowIso(),
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 2,
      authorId: 1,
      authorName: 'Demo Learner',
      title: 'React Query Crash Course',
      videoUrl: 'https://www.youtube.com/watch?v=novnyCaa7To',
      thumbnailUrl: 'https://i.ytimg.com/vi/novnyCaa7To/hqdefault.jpg',
      channelName: 'The Net Ninja',
      summary:
        'Explains server state, caching, refetching, query keys, and mutation flows for React applications.',
      translatedNotes:
        'React 앱에서 서버 상태, 캐싱, 재조회, 쿼리 키, mutation 흐름을 설명합니다.',
      tags: ['react', 'query', 'frontend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 3,
      authorId: 1,
      authorName: 'Demo Learner',
      title: 'FastAPI Full Course',
      videoUrl: 'https://www.youtube.com/watch?v=7t2alSnE2-I',
      thumbnailUrl: 'https://i.ytimg.com/vi/7t2alSnE2-I/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'Builds Python APIs with routing, validation, dependency injection, authentication, and database access.',
      translatedNotes:
        '라우팅, 검증, 의존성 주입, 인증, 데이터베이스 접근으로 Python API를 만드는 강의입니다.',
      tags: ['fastapi', 'python', 'backend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 4,
      authorId: 1,
      authorName: 'Demo Learner',
      title: 'PostgreSQL Tutorial for Beginners',
      videoUrl: 'https://www.youtube.com/watch?v=qw--VYLpxG4',
      thumbnailUrl: 'https://i.ytimg.com/vi/qw--VYLpxG4/hqdefault.jpg',
      channelName: 'Programming with Mosh',
      summary:
        'Introduces relational tables, filtering, joins, indexes, and the mindset for designing durable data models.',
      translatedNotes:
        '관계형 테이블, 필터링, 조인, 인덱스, 안정적인 데이터 모델 설계를 소개합니다.',
      tags: ['postgresql', 'database', 'backend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  protected playlists: Playlist[] = [
    {
      id: 1,
      ownerId: 1,
      title: 'React 기초 복습 루트',
      description: 'React 훅과 서버 상태 관리를 차례대로 복습합니다.',
      postIds: [1, 2],
      feedback: [],
      createdAt: nowIso(),
    },
  ];

  protected nextIds = {
    user: 2,
    post: 5,
    comment: 2,
    playlist: 2,
    feedback: 1,
  };

  async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<User> {
    const exists = await this.findUserByEmail(input.email);

    if (exists) {
      throw new Error('Email already exists');
    }

    const user: StoredUser = {
      id: this.nextIds.user++,
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      preferences: defaultPreferences(),
      createdAt: nowIso(),
    };
    this.users.push(user);

    return this.toPublicUser(user);
  }

  async findUserByEmail(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    await this.idle();

    return (
      this.users.find(
        (user) => user.email.toLowerCase() === email.toLowerCase(),
      ) ?? null
    );
  }

  async updateUser(
    id: number,
    input: {
      name?: string;
      passwordHash?: string;
      preferences?: LearningPreferences;
    },
  ): Promise<User | null> {
    await this.idle();

    const index = this.users.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      return null;
    }

    const current = this.users[index];
    const next: StoredUser = {
      ...current,
      name: input.name ?? current.name,
      passwordHash: input.passwordHash ?? current.passwordHash,
      preferences: input.preferences ?? current.preferences,
    };
    this.users[index] = next;

    if (input.name) {
      this.posts = this.posts.map((post) => ({
        ...post,
        authorName: post.authorId === id ? input.name! : post.authorName,
        comments: post.comments.map((comment) => ({
          ...comment,
          authorName:
            comment.authorId === id ? input.name! : comment.authorName,
        })),
      }));
    }

    return this.toPublicUser(next);
  }

  async createSession(userId: number, token: string): Promise<Session> {
    await this.idle();

    const user = this.users.find((candidate) => candidate.id === userId);

    if (!user) {
      throw new Error('User not found');
    }

    this.sessions.push({ token, userId });

    return {
      token,
      user: this.toPublicUser(user),
    };
  }

  async findSession(token: string): Promise<Session | null> {
    await this.idle();

    const session = this.sessions.find(
      (candidate) => candidate.token === token,
    );
    const user = session
      ? this.users.find((candidate) => candidate.id === session.userId)
      : null;

    return session && user
      ? {
          token: session.token,
          user: this.toPublicUser(user),
        }
      : null;
  }

  async listPosts(input: {
    authorId?: number;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedPosts> {
    await this.idle();

    const normalized = input.search?.trim().toLowerCase();
    const owned =
      typeof input.authorId === 'number'
        ? this.posts.filter((post) => post.authorId === input.authorId)
        : [...this.posts];
    const filtered = normalized
      ? owned.filter((post) =>
          [
            post.title,
            post.summary,
            post.channelName,
            post.translatedNotes,
            ...post.tags,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
        )
      : owned;
    const start = (input.page - 1) * input.pageSize;

    return {
      items: filtered.slice(start, start + input.pageSize).map((post) => ({
        ...post,
        comments: [...post.comments],
        tags: [...post.tags],
      })),
      total: filtered.length,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async findPost(id: number): Promise<StudyPost | null> {
    await this.idle();

    const post = this.posts.find((candidate) => candidate.id === id);

    return post
      ? {
          ...post,
          comments: [...post.comments],
          tags: [...post.tags],
        }
      : null;
  }

  async createPost(input: CreatePostInput): Promise<StudyPost> {
    await this.idle();

    const author = this.users.find((user) => user.id === input.authorId);

    if (!author) {
      throw new Error('Author not found');
    }

    const timestamp = nowIso();
    const post: StudyPost = {
      id: this.nextIds.post++,
      authorId: input.authorId,
      authorName: author.name,
      title: input.title,
      videoUrl: input.videoUrl,
      thumbnailUrl:
        input.thumbnailUrl ??
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      channelName: input.channelName ?? 'Unknown channel',
      summary: input.summary,
      translatedNotes: input.translatedNotes,
      tags: this.normalizeTags(input.tags),
      comments: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.posts.unshift(post);

    return { ...post, comments: [], tags: [...post.tags] };
  }

  async updatePost(
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost | null> {
    await this.idle();

    const index = this.posts.findIndex((post) => post.id === id);

    if (index === -1) {
      return null;
    }

    const current = this.posts[index];
    const next: StudyPost = {
      ...current,
      ...input,
      tags: input.tags ? this.normalizeTags(input.tags) : current.tags,
      updatedAt: nowIso(),
    };
    this.posts[index] = next;

    return { ...next, comments: [...next.comments], tags: [...next.tags] };
  }

  async deletePost(id: number): Promise<boolean> {
    await this.idle();

    const before = this.posts.length;
    this.posts = this.posts.filter((post) => post.id !== id);
    this.playlists = this.playlists.map((playlist) => ({
      ...playlist,
      postIds: playlist.postIds.filter((postId) => postId !== id),
    }));

    return this.posts.length !== before;
  }

  async addComment(input: {
    postId: number;
    authorId: number;
    body: string;
  }): Promise<Comment> {
    await this.idle();

    const post = this.posts.find((candidate) => candidate.id === input.postId);
    const author = this.users.find(
      (candidate) => candidate.id === input.authorId,
    );

    if (!post || !author) {
      throw new Error('Post or author not found');
    }

    const comment: Comment = {
      id: this.nextIds.comment++,
      postId: input.postId,
      authorId: input.authorId,
      authorName: author.name,
      body: input.body,
      createdAt: nowIso(),
    };
    post.comments.push(comment);

    return comment;
  }

  async listPlaylists(ownerId?: number): Promise<Playlist[]> {
    await this.idle();

    return this.playlists
      .filter((playlist) => (ownerId ? playlist.ownerId === ownerId : true))
      .map((playlist) => this.clonePlaylist(playlist));
  }

  async createPlaylist(input: {
    ownerId: number;
    title: string;
    description: string;
    postIds: number[];
  }): Promise<Playlist> {
    await this.idle();

    const playlist: Playlist = {
      id: this.nextIds.playlist++,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description,
      postIds: [...new Set(input.postIds)],
      feedback: [],
      createdAt: nowIso(),
    };
    this.playlists.unshift(playlist);

    return this.clonePlaylist(playlist);
  }

  async addPlaylistItem(
    playlistId: number,
    postId: number,
  ): Promise<Playlist | null> {
    await this.idle();

    const playlist = this.playlists.find(
      (candidate) => candidate.id === playlistId,
    );

    if (!playlist) {
      return null;
    }

    if (!playlist.postIds.includes(postId)) {
      playlist.postIds.push(postId);
    }

    return this.clonePlaylist(playlist);
  }

  async addPlaylistFeedback(input: {
    playlistId: number;
    authorId: number;
    rating: number;
    body: string;
  }): Promise<PlaylistFeedback> {
    await this.idle();

    const playlist = this.playlists.find(
      (candidate) => candidate.id === input.playlistId,
    );

    if (!playlist) {
      throw new Error('Playlist not found');
    }

    const feedback: PlaylistFeedback = {
      id: this.nextIds.feedback++,
      playlistId: input.playlistId,
      authorId: input.authorId,
      rating: input.rating,
      body: input.body,
      createdAt: nowIso(),
    };
    playlist.feedback.push(feedback);

    return feedback;
  }

  private toPublicUser(user: StoredUser): User {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      preferences: {
        interests: [...user.preferences.interests],
        pace: user.preferences.pace,
        goal: user.preferences.goal,
      },
      createdAt: user.createdAt,
    };
  }

  private clonePlaylist(playlist: Playlist): Playlist {
    return {
      ...playlist,
      postIds: [...playlist.postIds],
      feedback: [...playlist.feedback],
    };
  }

  private normalizeTags(tags: string[]): string[] {
    return [
      ...new Set(
        tags
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    ];
  }

  private idle(): Promise<void> {
    return Promise.resolve();
  }
}
