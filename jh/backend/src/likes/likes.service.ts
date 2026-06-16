import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommentEntity } from '../comments/comment.entity';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PostEntity } from '../posts/entities/post.entity';
import { CommentLikeEntity } from './comment-like.entity';
import { PostLikeEntity } from './post-like.entity';

@Injectable()
export class LikesService {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(CommentEntity)
    private readonly commentsRepository: Repository<CommentEntity>,
    @InjectRepository(PostLikeEntity)
    private readonly postLikesRepository: Repository<PostLikeEntity>,
    @InjectRepository(CommentLikeEntity)
    private readonly commentLikesRepository: Repository<CommentLikeEntity>,
  ) {}

  async likePost(postId: string, user: AuthenticatedUser) {
    await this.assertPostExists(postId);

    const existing = await this.postLikesRepository.findOneBy({
      postId,
      userId: user.id,
    });

    if (!existing) {
      await this.postLikesRepository
        .save(
          this.postLikesRepository.create({
            postId,
            userId: user.id,
          }),
        )
        .catch((error) => {
          if (!this.isUniqueViolation(error)) {
            throw error;
          }
        });
    }

    return this.getPostLikeResponse(
      postId,
      true,
      '게시글 좋아요를 눌렀습니다.',
    );
  }

  async unlikePost(postId: string, user: AuthenticatedUser) {
    await this.assertPostExists(postId);
    await this.postLikesRepository.delete({
      postId,
      userId: user.id,
    });

    return this.getPostLikeResponse(
      postId,
      false,
      '게시글 좋아요를 취소했습니다.',
    );
  }

  async likeComment(commentId: string, user: AuthenticatedUser) {
    await this.assertCommentExists(commentId);

    const existing = await this.commentLikesRepository.findOneBy({
      commentId,
      userId: user.id,
    });

    if (!existing) {
      await this.commentLikesRepository
        .save(
          this.commentLikesRepository.create({
            commentId,
            userId: user.id,
          }),
        )
        .catch((error) => {
          if (!this.isUniqueViolation(error)) {
            throw error;
          }
        });
    }

    return this.getCommentLikeResponse(
      commentId,
      true,
      '댓글 좋아요를 눌렀습니다.',
    );
  }

  async unlikeComment(commentId: string, user: AuthenticatedUser) {
    await this.assertCommentExists(commentId);
    await this.commentLikesRepository.delete({
      commentId,
      userId: user.id,
    });

    return this.getCommentLikeResponse(
      commentId,
      false,
      '댓글 좋아요를 취소했습니다.',
    );
  }

  private async getPostLikeResponse(
    postId: string,
    likedByMe: boolean,
    message: string,
  ) {
    return {
      message,
      postId,
      likeCount: await this.postLikesRepository.countBy({ postId }),
      likedByMe,
    };
  }

  private async getCommentLikeResponse(
    commentId: string,
    likedByMe: boolean,
    message: string,
  ) {
    return {
      message,
      commentId,
      likeCount: await this.commentLikesRepository.countBy({ commentId }),
      likedByMe,
    };
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

  private async assertCommentExists(commentId: string) {
    const exists = await this.commentsRepository.exists({
      where: {
        id: commentId,
      },
    });

    if (!exists) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      (error as Record<string, unknown>).code === '23505'
    );
  }
}
