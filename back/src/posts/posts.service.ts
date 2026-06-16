import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiSyncService } from '../ai-sync/ai-sync.service';
import { AuthUser } from '../common/types/auth-user.type';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsQueryDto } from './dto/get-posts.query.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsRepository } from './repositories/posts.repository';

@Injectable()
export class PostsService {
  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly aiSyncService: AiSyncService,
  ) {}

  async getPosts(query: GetPostsQueryDto) {
    const result = await this.postsRepository.findPosts({
      q: query.q,
      regionCode: query.regionCode,
      budgetCode: query.budgetCode,
      themeCode: query.themeCode,
      season: query.season,
      companion: query.companion,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });

    return {
      items: result.items,
      totalCount: result.totalCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / query.limit)),
      sort: query.sort,
    };
  }

  async getPostById(postId: number) {
    const post = await this.postsRepository.findPostById(postId);

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    return {
      post,
    };
  }

  async incrementViewCount(postId: number) {
    const result = await this.postsRepository.incrementViewCount(postId);

    if (!result) {
      throw new NotFoundException('Post not found.');
    }

    return result;
  }

  async createPost(user: AuthUser, createPostDto: CreatePostDto) {
    const resolvedFilters = await this.postsRepository.resolvePostFiltersByCode(
      createPostDto.regionCode,
      createPostDto.budgetCode,
      createPostDto.themeCode,
    );

    if (!resolvedFilters) {
      throw new BadRequestException('Invalid post filter code.');
    }

    const content = createPostDto.content?.trim() ?? null;
    const summary = this.buildSummary(content);
    const tags = createPostDto.tags?.length
      ? createPostDto.tags
      : [
          `#${resolvedFilters.region_name}`,
          `#${resolvedFilters.theme_name}`,
          `#${createPostDto.companion}`,
        ];

    const postId = await this.postsRepository.createPost({
      authorId: user.id,
      title: createPostDto.title.trim(),
      summary,
      content,
      imageUrl: createPostDto.imageUrl?.trim() ?? null,
      regionId: resolvedFilters.region_id,
      budgetRangeId: resolvedFilters.budget_range_id,
      themeId: resolvedFilters.theme_id,
      season: createPostDto.season,
      companion: createPostDto.companion,
      travelDate: createPostDto.travelDate,
      tags,
    });

    const post = await this.postsRepository.findPostById(postId);

    if (!post) {
      throw new NotFoundException('Created post not found.');
    }

    void this.aiSyncService.syncPost(post.id);

    return {
      message: 'Post created.',
      post,
    };
  }

  async updatePost(postId: number, user: AuthUser, updatePostDto: UpdatePostDto) {
    const currentPost = await this.postsRepository.findPostById(postId);

    if (!currentPost) {
      throw new NotFoundException('Post not found.');
    }

    if (currentPost.author.id !== user.id) {
      throw new ForbiddenException('You can only edit your own post.');
    }

    const nextRegionCode = updatePostDto.regionCode ?? currentPost.regionCode ?? '';
    const nextBudgetCode = updatePostDto.budgetCode ?? currentPost.budgetCode ?? '';
    const nextThemeCode = updatePostDto.themeCode ?? currentPost.themeCode ?? '';

    const shouldResolveFilters =
      updatePostDto.regionCode !== undefined ||
      updatePostDto.budgetCode !== undefined ||
      updatePostDto.themeCode !== undefined;

    const resolvedFilters = shouldResolveFilters
      ? await this.postsRepository.resolvePostFiltersByCode(
          nextRegionCode,
          nextBudgetCode,
          nextThemeCode,
        )
      : null;

    if (shouldResolveFilters && !resolvedFilters) {
      throw new BadRequestException('Invalid post filter code.');
    }

    const content =
      updatePostDto.content !== undefined
        ? updatePostDto.content.trim() || null
        : undefined;
    const summary =
      content !== undefined ? this.buildSummary(content) : undefined;

    await this.postsRepository.updatePost({
      postId,
      title:
        updatePostDto.title !== undefined
          ? updatePostDto.title.trim()
          : undefined,
      summary,
      content,
      imageUrl:
        updatePostDto.imageUrl !== undefined
          ? updatePostDto.imageUrl.trim() || null
          : undefined,
      regionId: resolvedFilters?.region_id,
      budgetRangeId: resolvedFilters?.budget_range_id,
      themeId: resolvedFilters?.theme_id,
      season: updatePostDto.season,
      companion: updatePostDto.companion,
      travelDate: updatePostDto.travelDate,
      tags: updatePostDto.tags,
    });

    const post = await this.postsRepository.findPostById(postId);

    if (!post) {
      throw new NotFoundException('Updated post not found.');
    }

    void this.aiSyncService.syncPost(post.id);

    return {
      message: 'Post updated.',
      post,
    };
  }

  async deletePost(postId: number, user: AuthUser) {
    const authorId = await this.postsRepository.findPostAuthorId(postId);

    if (!authorId) {
      throw new NotFoundException('Post not found.');
    }

    if (authorId !== user.id) {
      throw new ForbiddenException('You can only delete your own post.');
    }

    await this.postsRepository.deletePost(postId);
    void this.aiSyncService.syncPost(postId);

    return {
      message: 'Post deleted.',
      postId,
    };
  }

  private buildSummary(content: string | null) {
    if (!content) {
      return null;
    }

    if (content.length <= 96) {
      return content;
    }

    return `${content.slice(0, 96)}...`;
  }
}
