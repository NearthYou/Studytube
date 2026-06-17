import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { PrismaService } from 'src/database/prisma.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

const commentInclude = {
  author: true,
  replies: {
    where: {
      moderationStatus: 'VISIBLE',
      deletedAt: null,
    },
    include: {
      author: true,
      _count: {
        select: {
          replies: true,
          likes: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  _count: {
    select: {
      replies: true,
      likes: true,
    },
  },
} satisfies Prisma.CommentInclude;

type CommentWithAuthor = Prisma.CommentGetPayload<{
  include: typeof commentInclude;
}>;

type PublicCommentSource = {
  id: bigint;
  seatReviewId: bigint;
  parentId: bigint | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: bigint;
    nickname: string;
  };
  _count: {
    replies: number;
    likes: number;
  };
  replies?: PublicCommentSource[];
};

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    reviewId: string,
    user: AuthenticatedUser,
    dto: CreateCommentDto,
  ) {
    const seatReviewId = this.parseId(reviewId, 'reviewId');
    const authorId = this.parseId(user.id, 'userId');
    const content = this.normalizeContent(dto.content);
    const parentId = dto.parentId
      ? await this.getValidParentId(dto.parentId, seatReviewId)
      : null;

    await this.assertSeatReviewExists(seatReviewId);

    const comment = await this.prisma.comment.create({
      data: {
        seatReviewId,
        authorId,
        parentId,
        content,
      },
      include: commentInclude,
    });

    return this.toPublicComment(comment);
  }

  async findBySeatReview(reviewId: string, query: CommentQueryDto) {
    const seatReviewId = this.parseId(reviewId, 'reviewId');
    const sort = query.sort ?? 'oldest';

    await this.assertSeatReviewExists(seatReviewId);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: {
          seatReviewId,
          parentId: null,
          moderationStatus: 'VISIBLE',
          deletedAt: null,
        },
        include: commentInclude,
        orderBy: { createdAt: sort === 'latest' ? 'desc' : 'asc' },
      }),
      this.prisma.comment.count({
        where: {
          seatReviewId,
          parentId: null,
          moderationStatus: 'VISIBLE',
          deletedAt: null,
        },
      }),
    ]);

    return {
      items: items.map((comment) => this.toPublicComment(comment)),
      total,
      sort,
    };
  }

  async update(id: string, user: AuthenticatedUser, dto: UpdateCommentDto) {
    const commentId = this.parseId(id, 'id');
    const existingComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!existingComment) {
      throw new NotFoundException('Comment not found');
    }

    this.assertAuthor(existingComment.authorId, user.id);

    const updatedComment = await this.prisma.comment.update({
      where: { id: commentId },
      data: { content: this.normalizeContent(dto.content) },
      include: commentInclude,
    });

    return this.toPublicComment(updatedComment);
  }

  async like(id: string, user: AuthenticatedUser) {
    const commentId = this.parseId(id, 'id');
    const userId = this.parseId(user.id, 'userId');

    await this.assertCommentExists(commentId);

    await this.prisma.commentLike.create({
      data: { commentId, userId },
    });

    return { liked: true };
  }

  async unlike(id: string, user: AuthenticatedUser) {
    const commentId = this.parseId(id, 'id');
    const userId = this.parseId(user.id, 'userId');

    await this.assertCommentExists(commentId);

    await this.prisma.commentLike.deleteMany({
      where: { commentId, userId },
    });

    return { liked: false };
  }

  async remove(id: string, user: AuthenticatedUser) {
    const commentId = this.parseId(id, 'id');
    const existingComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!existingComment) {
      throw new NotFoundException('Comment not found');
    }

    this.assertAuthor(existingComment.authorId, user.id);

    await this.prisma.comment.delete({ where: { id: commentId } });

    return { deleted: true };
  }

  private async getValidParentId(parentIdValue: string, seatReviewId: bigint) {
    const parentId = this.parseId(parentIdValue, 'parentId');
    const parentComment = await this.prisma.comment.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        seatReviewId: true,
        parentId: true,
        moderationStatus: true,
        deletedAt: true,
      },
    });

    if (!parentComment) {
      throw new NotFoundException('Parent comment not found');
    }

    if (parentComment.seatReviewId !== seatReviewId) {
      throw new BadRequestException('Parent comment belongs to another review');
    }

    if (parentComment.moderationStatus !== 'VISIBLE' || parentComment.deletedAt) {
      throw new BadRequestException('Parent comment is not visible');
    }

    if (parentComment.parentId) {
      throw new BadRequestException('Nested replies are not supported');
    }

    return parentId;
  }

  private async assertSeatReviewExists(seatReviewId: bigint) {
    const review = await this.prisma.seatReview.findUnique({
      where: { id: seatReviewId },
      select: { id: true },
    });

    if (!review) {
      throw new NotFoundException('Seat review not found');
    }
  }

  private async assertCommentExists(commentId: bigint) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
  }

  private assertAuthor(authorId: bigint, currentUserId: string) {
    if (authorId !== this.parseId(currentUserId, 'userId')) {
      throw new ForbiddenException('You can only modify your own comment');
    }
  }

  private normalizeContent(value: string) {
    const content = value.trim();

    if (!content) {
      throw new BadRequestException('content must not be empty');
    }

    return content;
  }

  private parseId(value: string, fieldName: string) {
    try {
      const parsed = BigInt(value);

      if (parsed <= 0n) {
        throw new Error('ID must be positive');
      }

      return parsed;
    } catch {
      throw new BadRequestException(
        `${fieldName} must be a positive integer string`,
      );
    }
  }

  private parseMentions(content: string) {
    const mentions = new Set<string>();
    const mentionPattern = /@([\p{L}\p{N}_-]{2,30})/gu;
    let match: RegExpExecArray | null;

    while ((match = mentionPattern.exec(content))) {
      mentions.add(match[1]);
    }

    return Array.from(mentions);
  }

  private toPublicComment(comment: PublicCommentSource) {
    const replies = Array.isArray((comment as { replies?: unknown }).replies)
      ? (comment as { replies: PublicCommentSource[] }).replies
      : [];

    return {
      id: comment.id.toString(),
      seatReviewId: comment.seatReviewId.toString(),
      parentId: comment.parentId?.toString() ?? null,
      author: {
        id: comment.author.id.toString(),
        nickname: comment.author.nickname,
      },
      content: comment.content,
      mentions: this.parseMentions(comment.content),
      replyCount: comment._count.replies,
      likeCount: comment._count.likes,
      likedByMe: false,
      replies: replies.map((reply) => this.toPublicComment(reply)),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }
}
