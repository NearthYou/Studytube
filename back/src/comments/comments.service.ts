import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { CommentsRepository } from './repositories/comments.repository';

@Injectable()
export class CommentsService {
  constructor(private readonly commentsRepository: CommentsRepository) {}

  async getPostComments(postId: number) {
    const postExists = await this.commentsRepository.existsPost(postId);

    if (!postExists) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
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
      throw new BadRequestException('댓글 내용을 입력해주세요.');
    }

    const postExists = await this.commentsRepository.existsPost(postId);

    if (!postExists) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    const comment = await this.commentsRepository.createComment(
      postId,
      user.id,
      createCommentDto.content,
    );

    if (!comment) {
      throw new NotFoundException('생성된 댓글을 찾을 수 없습니다.');
    }

    return {
      message: '댓글이 등록되었습니다.',
      comment,
    };
  }

  async createReply(
    commentId: number,
    user: AuthUser,
    createReplyDto: CreateReplyDto,
  ) {
    if (!createReplyDto.content) {
      throw new BadRequestException('답글 내용을 입력해주세요.');
    }

    const postId = await this.commentsRepository.findCommentPostId(commentId);

    if (!postId) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }

    const reply = await this.commentsRepository.createReply(
      commentId,
      user.id,
      createReplyDto.content,
    );

    if (!reply) {
      throw new NotFoundException('생성된 답글을 찾을 수 없습니다.');
    }

    return {
      message: '답글이 등록되었습니다.',
      reply,
      commentId,
      postId,
    };
  }
}
