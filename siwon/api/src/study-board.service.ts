import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  assertEmail,
  assertPassword,
  assertPostInput,
  assertText,
  assertVideoTags,
  createSessionToken,
  hashPassword,
  normalizeBearerToken,
  normalizePreferences,
  toPositiveInteger,
  type Credentials,
} from './study-board.policy';
import type {
  BoardRepository,
  CreatePostInput,
  LearningPreferences,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  Session,
  StudyPost,
  UpdatePlaylistInput,
  UpdatePostInput,
  User,
} from './study-board.types';
import type { VideoAssetService } from './video-asset.service';
import type { VideoAsset } from './video-asset.types';

@Injectable()
export class StudyBoardService {
  constructor(
    private readonly repository: BoardRepository,
    private readonly videoAssetService?: VideoAssetService,
  ) {}

  async signUp(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<Session> {
    assertText(input.name, 'name');
    assertEmail(input.email);
    assertPassword(input.password);

    const email = input.email.trim().toLowerCase();
    const existing = await this.repository.findUserByEmail(email);

    if (existing) {
      throw new BadRequestException('Email already exists');
    }

    const user = await this.repository.createUser({
      name: input.name.trim(),
      email,
      passwordHash: hashPassword(input.password),
    });

    return this.repository.createSession(user.id, createSessionToken());
  }

  async login(input: Credentials): Promise<Session> {
    assertEmail(input.email);
    assertPassword(input.password);

    const user = await this.repository.findUserByEmail(
      input.email.trim().toLowerCase(),
    );

    if (!user || user.passwordHash !== hashPassword(input.password)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.repository.createSession(user.id, createSessionToken());
  }

  async getMe(token: string | undefined): Promise<User> {
    const session = await this.requireSession(token);

    return session.user;
  }

  async verifyMe(
    token: string | undefined,
    currentPassword: string | undefined,
  ): Promise<User> {
    const session = await this.requireSession(token);

    await this.requireCurrentPassword(session, currentPassword);

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
      ? normalizePreferences(input.preferences)
      : undefined;

    if (!nextName && !nextPassword && !preferences) {
      throw new BadRequestException(
        'name, password, or preferences is required',
      );
    }

    await this.requireCurrentPassword(session, currentPassword);

    if (nextName !== undefined) {
      assertText(nextName, 'name');
    }

    if (nextPassword) {
      assertPassword(nextPassword);
    }

    const user = await this.repository.updateUser(session.user.id, {
      name: nextName || undefined,
      passwordHash: nextPassword ? hashPassword(nextPassword) : undefined,
      preferences,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async requireCurrentPassword(
    session: Session,
    currentPassword: string | undefined,
  ) {
    const trimmedCurrentPassword = currentPassword?.trim();

    if (!trimmedCurrentPassword) {
      throw new UnauthorizedException('Current password is required');
    }

    const userWithPassword = await this.repository.findUserByEmail(
      session.user.email,
    );

    if (
      !userWithPassword ||
      userWithPassword.passwordHash !== hashPassword(trimmedCurrentPassword)
    ) {
      throw new UnauthorizedException('Current password is invalid');
    }
  }

  async listPosts(input: {
    token?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedPosts> {
    const session = await this.requireSession(input.token);
    const page = toPositiveInteger(input.page, 1);
    const pageSize = Math.min(toPositiveInteger(input.pageSize, 6), 24);

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
    const page = toPositiveInteger(input.page, 1);
    const pageSize = Math.min(toPositiveInteger(input.pageSize, 12), 48);

    return this.repository.listPosts({
      search: input.search,
      page,
      pageSize,
    });
  }

  async getPost(token: string | undefined, id: number): Promise<StudyPost> {
    await this.requireSession(token);

    return this.requirePost(id);
  }

  async getOwnedPost(
    token: string | undefined,
    id: number,
  ): Promise<StudyPost> {
    const session = await this.requireSession(token);

    return this.requireOwnedPost(id, session.user.id);
  }

  async createPost(
    token: string | undefined,
    input: Omit<CreatePostInput, 'authorId'>,
  ): Promise<StudyPost> {
    const session = await this.requireSession(token);
    assertPostInput(input);

    const post = await this.repository.createPost({
      ...input,
      authorId: session.user.id,
      tags: input.tags ?? [],
    });

    this.videoAssetService?.enqueuePost(post);

    return post;
  }

  async getVideoAsset(
    token: string | undefined,
    postId: number,
  ): Promise<VideoAsset> {
    await this.requireSession(token);
    await this.requirePost(postId);
    const asset = await this.repository.findVideoAsset(postId);

    if (!asset) {
      throw new NotFoundException('Video asset not found');
    }

    return asset;
  }

  async updatePost(
    token: string | undefined,
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost> {
    const session = await this.requireSession(token);
    const currentPost = await this.requireOwnedPost(id, session.user.id);
    assertVideoTags(input.tags);
    const videoUrlChanged =
      typeof input.videoUrl === 'string' &&
      input.videoUrl !== currentPost.videoUrl;

    const post = await this.repository.updatePost(id, input);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (videoUrlChanged) {
      this.videoAssetService?.enqueuePost(post);
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
    assertText(input.body, 'body');

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
    const comment = post.comments.find(
      (candidate) => candidate.id === commentId,
    );

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

  async listPlaylists(
    token?: string,
    scope: 'mine' | 'public' = 'public',
  ): Promise<Playlist[]> {
    if (scope === 'mine') {
      const session = await this.requireSession(token);

      return this.repository.listPlaylists(session.user.id);
    }

    return this.repository.listPlaylists();
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
    assertText(input.title, 'title');

    return this.repository.createPlaylist({
      ownerId: session.user.id,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      postIds: input.postIds ?? [],
    });
  }

  async updatePlaylist(
    token: string | undefined,
    id: number,
    input: UpdatePlaylistInput,
  ): Promise<Playlist> {
    const session = await this.requireSession(token);
    await this.requireOwnedPlaylist(id, session.user.id);

    const title = input.title !== undefined ? input.title.trim() : undefined;
    const description =
      input.description !== undefined ? input.description.trim() : undefined;
    const hasPostIds = input.postIds !== undefined;

    if (title === undefined && description === undefined && !hasPostIds) {
      throw new BadRequestException(
        'title, description, or postIds is required',
      );
    }

    if (title !== undefined) {
      assertText(title, 'title');
    }

    const playlist = await this.repository.updatePlaylist(id, {
      title,
      description,
      postIds: hasPostIds ? input.postIds : undefined,
    });

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    return playlist;
  }

  async deletePlaylist(
    token: string | undefined,
    id: number,
  ): Promise<{
    deleted: boolean;
  }> {
    const session = await this.requireSession(token);
    await this.requireOwnedPlaylist(id, session.user.id);

    return {
      deleted: await this.repository.deletePlaylist(id),
    };
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

    assertText(input.body, 'body');

    return this.repository.addPlaylistFeedback({
      playlistId,
      authorId: session.user.id,
      rating,
      body: input.body.trim(),
    });
  }

  private async requireSession(token?: string): Promise<Session> {
    const normalized = normalizeBearerToken(token);
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

  private async requireOwnedPlaylist(
    playlistId: number,
    userId: number,
  ): Promise<Playlist> {
    const playlist = (await this.repository.listPlaylists(userId)).find(
      (candidate) => candidate.id === playlistId,
    );

    if (!playlist) {
      throw new NotFoundException('Playlist not found');
    }

    return playlist;
  }

  private async requirePost(postId: number): Promise<StudyPost> {
    const post = await this.repository.findPost(postId);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }
}
