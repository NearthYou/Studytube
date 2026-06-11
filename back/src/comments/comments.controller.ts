import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { CommentsService } from './comments.service';

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
}
