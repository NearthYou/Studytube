import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  BoardRepository,
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

type Credentials = {
  email: string;
  password: string;
};

@Injectable()
export class StudyBoardService {
  constructor(private readonly repository: BoardRepository) {}

  async signUp(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<Session> {
    this.assertText(input.name, 'name');
    this.assertEmail(input.email);
    this.assertPassword(input.password);

    const email = input.email.trim().toLowerCase();
    const existing = await this.repository.findUserByEmail(email);

    if (existing) {
      throw new BadRequestException('Email already exists');
    }

    const user = await this.repository.createUser({
      name: input.name.trim(),
      email,
      passwordHash: this.hashPassword(input.password),
    });

    return this.repository.createSession(user.id, this.createToken());
  }

  async login(input: Credentials): Promise<Session> {
    this.assertEmail(input.email);
    this.assertPassword(input.password);

    const user = await this.repository.findUserByEmail(
      input.email.trim().toLowerCase(),
    );

    if (!user || user.passwordHash !== this.hashPassword(input.password)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.repository.createSession(user.id, this.createToken());
  }

  async demoSession(): Promise<Session> {
    const demoUser = await this.repository.findUserByEmail(
      'demo@studytube.local',
    );

    if (!demoUser) {
      const created = await this.repository.createUser({
        name: 'Demo Learner',
        email: 'demo@studytube.local',
        passwordHash: this.hashPassword('demo1234'),
      });

      return this.repository.createSession(created.id, this.createToken());
    }

    return this.repository.createSession(demoUser.id, this.createToken());
  }

  async getMe(token: string | undefined): Promise<User> {
    const session = await this.requireSession(token);

    return session.user;
  }

  async updateMe(
    token: string | undefined,
    input: {
      currentPassword?: string;
      name?: string;
      password?: string;
      preferences?: LearningPreferences;
    },
  ): Promise<User> {
    const session = await this.requireSession(token);
    const nextName = input.name?.trim();
    const nextPassword = input.password?.trim();
    const currentPassword = input.currentPassword?.trim();
    const preferences = input.preferences
      ? this.normalizePreferences(input.preferences)
      : undefined;

    if (!nextName && !nextPassword && !preferences) {
      throw new BadRequestException('name, password, or preferences is required');
    }

    if (!currentPassword) {
      throw new UnauthorizedException('Current password is required');
    }

    const userWithPassword = await this.repository.findUserByEmail(
      session.user.email,
    );

    if (
      !userWithPassword ||
      userWithPassword.passwordHash !== this.hashPassword(currentPassword)
    ) {
      throw new UnauthorizedException('Current password is invalid');
    }

    if (nextName !== undefined) {
      this.assertText(nextName, 'name');
    }

    if (nextPassword) {
      this.assertPassword(nextPassword);
    }

    const user = await this.repository.updateUser(session.user.id, {
      name: nextName || undefined,
      passwordHash: nextPassword
        ? this.hashPassword(nextPassword)
        : undefined,
      preferences,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async listPosts(input: {
    token?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedPosts> {
    const session = await this.requireSession(input.token);
    const page = this.toPositiveInteger(input.page, 1);
    const pageSize = Math.min(this.toPositiveInteger(input.pageSize, 6), 24);

    return this.repository.listPosts({
      authorId: session.user.id,
      search: input.search,
      page,
      pageSize,
    });
  }

  async listPublicPosts(input: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedPosts> {
    const page = this.toPositiveInteger(input.page, 1);
    const pageSize = Math.min(this.toPositiveInteger(input.pageSize, 12), 48);

    return this.repository.listPosts({
      search: input.search,
      page,
      pageSize,
    });
  }

  async getPost(token: string | undefined, id: number): Promise<StudyPost> {
    const session = await this.requireSession(token);
    const post = await this.repository.findPost(id);

    if (!post || post.authorId !== session.user.id) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async createPost(
    token: string | undefined,
    input: Omit<CreatePostInput, 'authorId'>,
  ): Promise<StudyPost> {
    const session = await this.requireSession(token);
    this.assertPostInput(input);

    return this.repository.createPost({
      ...input,
      authorId: session.user.id,
      tags: input.tags ?? [],
    });
  }

  async updatePost(
    token: string | undefined,
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost> {
    const session = await this.requireSession(token);
    await this.requireOwnedPost(id, session.user.id);

    const post = await this.repository.updatePost(id, input);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async deletePost(
    token: string | undefined,
    id: number,
  ): Promise<{
    deleted: boolean;
  }> {
    const session = await this.requireSession(token);
    await this.requireOwnedPost(id, session.user.id);

    return {
      deleted: await this.repository.deletePost(id),
    };
  }

  async addComment(
    token: string | undefined,
    postId: number,
    input: { body: string },
  ) {
    const session = await this.requireSession(token);
    await this.requirePost(postId);
    this.assertText(input.body, 'body');

    return this.repository.addComment({
      postId,
      authorId: session.user.id,
      body: input.body.trim(),
    });
  }

  async deleteComment(
    token: string | undefined,
    postId: number,
    commentId: number,
  ): Promise<{
    deleted: boolean;
  }> {
    const session = await this.requireSession(token);
    const post = await this.requirePost(postId);
    const comment = post.comments.find((candidate) => candidate.id === commentId);

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (
      comment.authorId !== session.user.id &&
      post.authorId !== session.user.id
    ) {
      throw new ForbiddenException('Cannot delete this comment');
    }

    return {
      deleted: await this.repository.deleteComment(postId, commentId),
    };
  }

  async listPlaylists(token?: string): Promise<Playlist[]> {
    const session = token ? await this.requireSession(token) : null;

    return this.repository.listPlaylists(session?.user.id);
  }

  async createPlaylist(
    token: string | undefined,
    input: {
      title: string;
      description: string;
      postIds: number[];
    },
  ): Promise<Playlist> {
    const session = await this.requireSession(token);
    this.assertText(input.title, 'title');

    return this.repository.createPlaylist({
      ownerId: session.user.id,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      postIds: input.postIds ?? [],
    });
  }

  async addPlaylistItem(
    token: string | undefined,
    playlistId: number,
    postId: number,
  ): Promise<Playlist> {
    await this.requireSession(token);
    const playlist = await this.repository.addPlaylistItem(playlistId, postId);

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    return playlist;
  }

  async addPlaylistFeedback(
    token: string | undefined,
    playlistId: number,
    input: {
      rating: number;
      body: string;
    },
  ): Promise<PlaylistFeedback> {
    const session = await this.requireSession(token);
    const rating = Number(input.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('rating must be an integer from 1 to 5');
    }

    this.assertText(input.body, 'body');

    return this.repository.addPlaylistFeedback({
      playlistId,
      authorId: session.user.id,
      rating,
      body: input.body.trim(),
    });
  }

  private async requireSession(token?: string): Promise<Session> {
    const normalized = this.normalizeToken(token);
    const session = normalized
      ? await this.repository.findSession(normalized)
      : null;

    if (!session) {
      throw new UnauthorizedException('Login required');
    }

    return session;
  }

  private async requireOwnedPost(
    postId: number,
    userId: number,
  ): Promise<StudyPost> {
    const post = await this.requirePost(postId);

    if (post.authorId !== userId) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private async requirePost(postId: number): Promise<StudyPost> {
    const post = await this.repository.findPost(postId);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private normalizeToken(token?: string): string | undefined {
    if (!token) {
      return undefined;
    }

    return token.replace(/^Bearer\s+/i, '').trim();
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  private createToken(): string {
    return randomBytes(24).toString('hex');
  }

  private assertPostInput(input: Omit<CreatePostInput, 'authorId'>) {
    this.assertText(input.title, 'title');
    this.assertText(input.videoUrl, 'videoUrl');
    this.assertText(input.summary, 'summary');
    this.assertText(input.translatedNotes, 'translatedNotes');
  }

  private normalizePreferences(input: LearningPreferences): LearningPreferences {
    const interests = [
      ...new Set(
        (input.interests ?? [])
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 8),
      ),
    ];
    const pace = input.pace?.trim();
    const goal = input.goal?.trim();

    if (interests.length === 0) {
      throw new BadRequestException('preferences.interests is required');
    }

    this.assertText(pace, 'preferences.pace');
    this.assertText(goal, 'preferences.goal');

    return {
      interests,
      pace,
      goal,
    };
  }

  private assertEmail(email: string) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('email must be valid');
    }
  }

  private assertPassword(password: string) {
    if (!password || password.length < 6) {
      throw new BadRequestException('password must be at least 6 characters');
    }
  }

  private assertText(value: string | undefined, field: string) {
    if (!value?.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
  }

  private toPositiveInteger(
    value: number | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
      return fallback;
    }

    return parsed;
  }
}
