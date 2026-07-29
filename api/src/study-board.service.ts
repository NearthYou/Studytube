import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CourseCutoverPolicy,
  CourseCutoverPolicyError,
} from './course/course-cutover.policy';
import {
  assertPostInput,
  assertText,
  assertVideoTags,
  toPositiveInteger,
} from './study-board.policy';
import type {
  BoardRepository,
  CreatePostInput,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  StudyPost,
  UpdatePlaylistInput,
  UpdatePostInput,
} from './study-board.types';
import type { VideoAssetService } from './video-asset.service';
import type { VideoAsset } from './video-asset.types';

export type BoardActor = Readonly<{ userId: number }>;

@Injectable()
export class StudyBoardService {
  constructor(
    private readonly repository: BoardRepository,
    private readonly videoAssetService?: VideoAssetService,
    private readonly courseCutoverPolicy = new CourseCutoverPolicy('legacy'),
  ) {}

  async listPosts(
    actor: BoardActor,
    input: {
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PaginatedPosts> {
    const page = toPositiveInteger(input.page, 1);
    const pageSize = Math.min(toPositiveInteger(input.pageSize, 6), 24);

    return this.repository.listPosts({
      authorId: actor.userId,
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

  async getPost(_actor: BoardActor, id: number): Promise<StudyPost> {
    return this.requirePost(id);
  }

  async getOwnedPost(actor: BoardActor, id: number): Promise<StudyPost> {
    return this.requireOwnedPost(id, actor.userId);
  }

  async createPost(
    actor: BoardActor,
    input: Omit<CreatePostInput, 'authorId'>,
  ): Promise<StudyPost> {
    this.assertSourceMutationAllowed();
    return this.withCourseWriterSharedLease(async () => {
      assertPostInput(input);
      await this.assertUniqueVideoPost(actor.userId, input.videoUrl);

      const post = await this.repository.createPost({
        ...input,
        authorId: actor.userId,
        tags: input.tags ?? [],
      });

      this.videoAssetService?.enqueuePost(post);

      return post;
    });
  }

  async getVideoAsset(_actor: BoardActor, postId: number): Promise<VideoAsset> {
    await this.requirePost(postId);
    const asset = await this.repository.findVideoAsset(postId);

    if (!asset) {
      throw new NotFoundException('Video asset not found');
    }

    return asset;
  }

  async updatePost(
    actor: BoardActor,
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost> {
    this.assertSourceMutationAllowed();
    return this.withCourseWriterSharedLease(async () => {
      const currentPost = await this.requireOwnedPost(id, actor.userId);
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
    });
  }

  async deletePost(
    actor: BoardActor,
    id: number,
  ): Promise<{
    deleted: boolean;
  }> {
    this.assertSourceMutationAllowed();
    return this.withCourseWriterSharedLease(async () => {
      await this.requireOwnedPost(id, actor.userId);

      if (
        this.courseCutoverPolicy.mode !== 'course' &&
        (await this.repository.hasCompletedCourseBackfillAuditForPost(id))
      ) {
        throw new ConflictException(
          'An audited legacy source post cannot be deleted before Course activation',
        );
      }

      return {
        deleted: await this.repository.deletePost(id),
      };
    });
  }

  async addComment(actor: BoardActor, postId: number, input: { body: string }) {
    await this.requirePost(postId);
    assertText(input.body, 'body');

    return this.repository.addComment({
      postId,
      authorId: actor.userId,
      body: input.body.trim(),
    });
  }

  async deleteComment(
    actor: BoardActor,
    postId: number,
    commentId: number,
  ): Promise<{
    deleted: boolean;
  }> {
    const post = await this.requirePost(postId);
    const comment = post.comments.find(
      (candidate) => candidate.id === commentId,
    );

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== actor.userId && post.authorId !== actor.userId) {
      throw new ForbiddenException('Cannot delete this comment');
    }

    return {
      deleted: await this.repository.deleteComment(postId, commentId),
    };
  }

  async listPlaylists(actor: BoardActor): Promise<Playlist[]> {
    return this.repository.listPlaylists(actor.userId);
  }

  async createPlaylist(
    actor: BoardActor,
    input: {
      title: string;
      description: string;
      postIds: number[];
    },
  ): Promise<Playlist> {
    this.assertLegacyMutationAllowed();
    return this.withCourseWriterSharedLease(() => {
      assertText(input.title, 'title');

      return this.repository.createPlaylist({
        ownerId: actor.userId,
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        postIds: input.postIds ?? [],
      });
    });
  }

  async updatePlaylist(
    actor: BoardActor,
    id: number,
    input: UpdatePlaylistInput,
  ): Promise<Playlist> {
    this.assertLegacyMutationAllowed();
    return this.withCourseWriterSharedLease(async () => {
      await this.requireOwnedPlaylist(id, actor.userId);

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
    });
  }

  async deletePlaylist(
    actor: BoardActor,
    id: number,
  ): Promise<{
    deleted: boolean;
  }> {
    this.assertLegacyMutationAllowed();
    return this.withCourseWriterSharedLease(async () => {
      await this.requireOwnedPlaylist(id, actor.userId);

      return {
        deleted: await this.repository.deletePlaylist(id),
      };
    });
  }

  async addPlaylistItem(
    _actor: BoardActor,
    playlistId: number,
    postId: number,
  ): Promise<Playlist> {
    this.assertLegacyMutationAllowed();
    return this.withCourseWriterSharedLease(async () => {
      const playlist = await this.repository.addPlaylistItem(
        playlistId,
        postId,
      );

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      return playlist;
    });
  }

  async addPlaylistFeedback(
    actor: BoardActor,
    playlistId: number,
    input: {
      rating: number;
      body: string;
    },
  ): Promise<PlaylistFeedback> {
    this.assertLegacyMutationAllowed();
    return this.withCourseWriterSharedLease(() => {
      const rating = Number(input.rating);

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new BadRequestException('rating must be an integer from 1 to 5');
      }

      assertText(input.body, 'body');

      return this.repository.addPlaylistFeedback({
        playlistId,
        authorId: actor.userId,
        rating,
        body: input.body.trim(),
      });
    });
  }

  private withCourseWriterSharedLease<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    return (
      this.repository.withCourseWriterSharedLease?.(operation) ?? operation()
    );
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

  private assertSourceMutationAllowed(): void {
    try {
      this.courseCutoverPolicy.assertSourceMutationAllowed();
    } catch (error) {
      if (!(error instanceof CourseCutoverPolicyError)) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Source mutations are paused during Course cutover verification',
      );
    }
  }

  private assertLegacyMutationAllowed(): void {
    try {
      this.courseCutoverPolicy.assertLegacyMutationAllowed();
    } catch (error) {
      if (!(error instanceof CourseCutoverPolicyError)) {
        throw error;
      }

      if (this.courseCutoverPolicy.mode === 'course') {
        throw new NotFoundException('Legacy playlist mutation route retired');
      }

      throw new ServiceUnavailableException(
        'Legacy playlist mutations are paused during Course cutover verification',
      );
    }
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

  private async assertUniqueVideoPost(authorId: number, videoUrl: string) {
    const targetIdentity = normalizePostVideoIdentity(videoUrl);
    const pageSize = 100;
    let page = 1;
    let total = 0;

    do {
      const result = await this.repository.listPosts({
        authorId,
        page,
        pageSize,
      });
      const duplicate = result.items.find(
        (post) => normalizePostVideoIdentity(post.videoUrl) === targetIdentity,
      );

      if (duplicate) {
        throw new BadRequestException('Same video post already exists');
      }

      total = result.total;
      page += 1;
    } while ((page - 1) * pageSize < total);
  }
}

function normalizePostVideoIdentity(videoUrl: string) {
  const trimmed = videoUrl.trim();

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' && pathParts[0]) {
      return `youtube:${pathParts[0]}`;
    }

    if (host.endsWith('youtube.com')) {
      const watchVideoId = parsed.searchParams.get('v');
      const pathVideoId =
        ['embed', 'shorts', 'live'].includes(pathParts[0]) && pathParts[1]
          ? pathParts[1]
          : '';
      const videoId = watchVideoId || pathVideoId;

      if (videoId) {
        return `youtube:${videoId}`;
      }
    }

    parsed.hash = '';
    parsed.searchParams.sort();

    return `url:${parsed.toString().replace(/\/$/, '')}`;
  } catch {
    return `url:${trimmed.toLowerCase().replace(/\/$/, '')}`;
  }
}
