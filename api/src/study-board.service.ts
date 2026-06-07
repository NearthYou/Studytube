import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  BoardRepository,
  CreatePostInput,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  Session,
  StudyPost,
  UpdatePostInput,
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

    const user = await this.repository.createUser({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
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

  listPosts(input: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedPosts> {
    const page = this.toPositiveInteger(input.page, 1);
    const pageSize = Math.min(this.toPositiveInteger(input.pageSize, 6), 24);

    return this.repository.listPosts({
      search: input.search,
      page,
      pageSize,
    });
  }

  async getPost(id: number): Promise<StudyPost> {
    const post = await this.repository.findPost(id);

    if (!post) {
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
    await this.requireSession(token);

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
    await this.requireSession(token);

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
    this.assertText(input.body, 'body');

    return this.repository.addComment({
      postId,
      authorId: session.user.id,
      body: input.body.trim(),
    });
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
