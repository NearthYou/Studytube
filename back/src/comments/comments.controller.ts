import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdateReplyDto } from './dto/update-reply.dto';

type RequestWithUser = Request & {
  user: AuthUser;
};

@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('posts/:postId/comments')
  async getPostComments(@Param('postId', ParseIntPipe) postId: number) {
    return this.commentsService.getPostComments(postId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('posts/:postId/comments')
  async createComment(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: RequestWithUser,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(
      postId,
      request.user,
      createCommentDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('comments/:commentId/replies')
  async createReply(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() request: RequestWithUser,
    @Body() createReplyDto: CreateReplyDto,
  ) {
    return this.commentsService.createReply(
      commentId,
      request.user,
      createReplyDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('comments/:commentId')
  async updateComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() request: RequestWithUser,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.updateComment(
      commentId,
      request.user,
      updateCommentDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:commentId')
  async deleteComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() request: RequestWithUser,
  ) {
    return this.commentsService.deleteComment(commentId, request.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('replies/:replyId')
  async updateReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @Req() request: RequestWithUser,
    @Body() updateReplyDto: UpdateReplyDto,
  ) {
    return this.commentsService.updateReply(
      replyId,
      request.user,
      updateReplyDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('replies/:replyId')
  async deleteReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @Req() request: RequestWithUser,
  ) {
    return this.commentsService.deleteReply(replyId, request.user);
  }
}
