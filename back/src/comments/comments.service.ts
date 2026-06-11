import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdateReplyDto } from './dto/update-reply.dto';
import { CommentsRepository } from './repositories/comments.repository';

@Injectable()
export class CommentsService {
  constructor(private readonly commentsRepository: CommentsRepository) {}

  async getPostComments(postId: number) {
    const postExists = await this.commentsRepository.existsPost(postId);

    if (!postExists) {
      throw new NotFoundException('Post not found.');
    }

    return {
      items: await this.commentsRepository.findPostComments(postId),
    };
  }

  async createComment(
    postId: number,
    user: AuthUser,
    createCommentDto: CreateCommentDto,
  ) {
    if (!createCommentDto.content) {
      throw new BadRequestException('Comment content is required.');
    }

    const postExists = await this.commentsRepository.existsPost(postId);

    if (!postExists) {
      throw new NotFoundException('Post not found.');
    }

    const comment = await this.commentsRepository.createComment(
      postId,
      user.id,
      createCommentDto.content,
    );

    if (!comment) {
      throw new NotFoundException('Created comment not found.');
    }

    return {
      message: 'Comment created.',
      comment,
    };
  }

  async createReply(
    commentId: number,
    user: AuthUser,
    createReplyDto: CreateReplyDto,
  ) {
    if (!createReplyDto.content) {
      throw new BadRequestException('Reply content is required.');
    }

    const postId = await this.commentsRepository.findCommentPostId(commentId);

    if (!postId) {
      throw new NotFoundException('Comment not found.');
    }

    const reply = await this.commentsRepository.createReply(
      commentId,
      user.id,
      createReplyDto.content,
    );

    if (!reply) {
      throw new NotFoundException('Created reply not found.');
    }

    return {
      message: 'Reply created.',
      reply,
      commentId,
      postId,
    };
  }

  async updateComment(
    commentId: number,
    user: AuthUser,
    updateCommentDto: UpdateCommentDto,
  ) {
    if (!updateCommentDto.content) {
      throw new BadRequestException('Comment content is required.');
    }

    const comment = await this.commentsRepository.findCommentByIdForOwnership(
      commentId,
    );

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    if (comment.author_id !== user.id) {
      throw new ForbiddenException('You can only edit your own comment.');
    }

    const updatedComment = await this.commentsRepository.updateComment(
      commentId,
      updateCommentDto.content,
    );

    if (!updatedComment) {
      throw new NotFoundException('Updated comment not found.');
    }

    return {
      message: 'Comment updated.',
      comment: updatedComment,
      postId: comment.post_id,
    };
  }

  async deleteComment(commentId: number, user: AuthUser) {
    const comment = await this.commentsRepository.findCommentByIdForOwnership(
      commentId,
    );

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    if (comment.author_id !== user.id) {
      throw new ForbiddenException('You can only delete your own comment.');
    }

    await this.commentsRepository.deleteComment(commentId);

    return {
      message: 'Comment deleted.',
      commentId,
      postId: comment.post_id,
    };
  }

  async updateReply(
    replyId: number,
    user: AuthUser,
    updateReplyDto: UpdateReplyDto,
  ) {
    if (!updateReplyDto.content) {
      throw new BadRequestException('Reply content is required.');
    }

    const reply = await this.commentsRepository.findReplyByIdForOwnership(
      replyId,
    );

    if (!reply) {
      throw new NotFoundException('Reply not found.');
    }

    if (reply.author_id !== user.id) {
      throw new ForbiddenException('You can only edit your own reply.');
    }

    const updatedReply = await this.commentsRepository.updateReply(
      replyId,
      updateReplyDto.content,
    );

    if (!updatedReply) {
      throw new NotFoundException('Updated reply not found.');
    }

    const postId = await this.commentsRepository.findCommentPostId(
      reply.comment_id,
    );

    return {
      message: 'Reply updated.',
      reply: updatedReply,
      commentId: reply.comment_id,
      postId,
    };
  }

  async deleteReply(replyId: number, user: AuthUser) {
    const reply = await this.commentsRepository.findReplyByIdForOwnership(
      replyId,
    );

    if (!reply) {
      throw new NotFoundException('Reply not found.');
    }

    if (reply.author_id !== user.id) {
      throw new ForbiddenException('You can only delete your own reply.');
    }

    await this.commentsRepository.deleteReply(replyId);
    const postId = await this.commentsRepository.findCommentPostId(
      reply.comment_id,
    );

    return {
      message: 'Reply deleted.',
      replyId,
      commentId: reply.comment_id,
      postId,
    };
  }
}
