import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CommentLikeEntity } from '../likes/comment-like.entity';
import { PostEntity } from '../posts/entities/post.entity';
import { CommentEntity } from './comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsDto } from './dto/list-comments.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

interface CommentStats {
  likeCounts: Map<string, number>;
  likedCommentIds: Set<string>;
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(CommentEntity)
    private readonly commentsRepository: Repository<CommentEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(CommentLikeEntity)
    private readonly commentLikesRepository: Repository<CommentLikeEntity>,
  ) {}

  async findByPost(
    postId: string,
    dto: ListCommentsDto,
    user?: AuthenticatedUser,
  ) {
    await this.assertPostExists(postId);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const [comments, totalCount] = await this.commentsRepository.findAndCount({
      where: {
        postId,
      },
      relations: {
        author: true,
      },
      order: {
        createdAt: 'ASC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });
    const stats = await this.getCommentStats(
      comments.map((comment) => comment.id),
      user?.id,
    );

    return {
      message: '댓글 목록을 조회했습니다.',
      items: comments.map((comment) => this.toResponse(comment, stats, user)),
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async create(postId: string, dto: CreateCommentDto, user: AuthenticatedUser) {
    await this.assertPostExists(postId);

    const comment = await this.commentsRepository.save(
      this.commentsRepository.create({
        postId,
        userId: user.id,
        content: dto.content.trim(),
      }),
    );

    const savedComment = await this.findOneOrThrow(comment.id);

    return {
      message: '댓글이 등록되었습니다.',
      comment: this.toResponse(
        savedComment,
        {
          likeCounts: new Map(),
          likedCommentIds: new Set(),
        },
        user,
      ),
    };
  }

  async update(
    commentId: string,
    dto: UpdateCommentDto,
    user: AuthenticatedUser,
  ) {
    const comment = await this.findOneOrThrow(commentId);

    this.assertCommentOwner(comment, user);

    comment.content = dto.content.trim();
    comment.updatedAt = new Date();
    const savedComment = await this.commentsRepository.save(comment);

    return {
      message: '댓글이 수정되었습니다.',
      comment: this.toResponse(
        savedComment,
        {
          likeCounts: new Map(),
          likedCommentIds: new Set(),
        },
        user,
      ),
    };
  }

  async remove(commentId: string, user: AuthenticatedUser) {
    const comment = await this.findOneOrThrow(commentId);

    this.assertCommentOwner(comment, user);
    await this.commentsRepository.delete({ id: comment.id });

    return {
      message: '댓글이 삭제되었습니다.',
      commentId,
    };
  }

  private async findOneOrThrow(commentId: string) {
    const comment = await this.commentsRepository.findOne({
      where: {
        id: commentId,
      },
      relations: {
        author: true,
      },
    });

    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }

    return comment;
  }

  private async assertPostExists(postId: string) {
    const exists = await this.postsRepository.exists({
      where: {
        id: postId,
      },
    });

    if (!exists) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }
  }

  private async getCommentStats(
    commentIds: string[],
    currentUserId?: string,
  ): Promise<CommentStats> {
    if (!commentIds.length) {
      return {
        likeCounts: new Map(),
        likedCommentIds: new Set(),
      };
    }

    const [likeRows, likedRows] = await Promise.all([
      this.commentLikesRepository
        .createQueryBuilder('like')
        .select('like.commentId', 'commentId')
        .addSelect('COUNT(*)', 'count')
        .where('like.commentId IN (:...commentIds)', { commentIds })
        .groupBy('like.commentId')
        .getRawMany<{ commentId: string; count: string }>(),
      currentUserId
        ? this.commentLikesRepository.findBy({
            userId: currentUserId,
            commentId: In(commentIds),
          })
        : Promise.resolve([]),
    ]);

    return {
      likeCounts: new Map(
        likeRows.map((row) => [String(row.commentId), Number(row.count)]),
      ),
      likedCommentIds: new Set(likedRows.map((row) => row.commentId)),
    };
  }

  private toResponse(
    comment: CommentEntity,
    stats: CommentStats,
    user?: AuthenticatedUser,
  ) {
    return {
      id: comment.id,
      postId: comment.postId,
      content: comment.content,
      body: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: {
        id: comment.author?.id ?? comment.userId,
        nickname: comment.author?.nickname ?? '알 수 없음',
        profileImageUrl: comment.author?.profileImageUrl ?? null,
      },
      likeCount: stats.likeCounts.get(comment.id) ?? 0,
      likedByMe: stats.likedCommentIds.has(comment.id),
      isOwner: user?.id === comment.userId,
    };
  }

  private assertCommentOwner(
    comment: Pick<CommentEntity, 'userId'>,
    user: AuthenticatedUser,
  ) {
    if (comment.userId !== user.id) {
      throw new ForbiddenException('댓글을 수정할 권한이 없습니다.');
    }
  }
}
