import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsQueryDto } from './dto/get-posts.query.dto';
import { PostsRepository } from './repositories/posts.repository';

@Injectable()
export class PostsService {
  constructor(private readonly postsRepository: PostsRepository) {}

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
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    return {
      post,
    };
  }

  async incrementViewCount(postId: number) {
    const result = await this.postsRepository.incrementViewCount(postId);

    if (!result) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
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
      throw new BadRequestException('유효하지 않은 지역/예산/테마 코드입니다.');
    }

    const content = createPostDto.content?.trim() ?? null;
    const summary = this.buildSummary(content);
    const tags =
      createPostDto.tags?.length
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
      throw new NotFoundException('생성된 게시글을 찾을 수 없습니다.');
    }

    return {
      message: '게시글이 등록되었습니다.',
      post,
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
