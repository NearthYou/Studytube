import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdateReplyDto } from './dto/update-reply.dto';

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
    @CurrentUser() user: AuthUser,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(
      postId,
      user,
      createCommentDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('comments/:commentId/replies')
  async createReply(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: AuthUser,
    @Body() createReplyDto: CreateReplyDto,
  ) {
    return this.commentsService.createReply(
      commentId,
      user,
      createReplyDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('comments/:commentId')
  async updateComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: AuthUser,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.updateComment(
      commentId,
      user,
      updateCommentDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:commentId')
  async deleteComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.commentsService.deleteComment(commentId, user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('replies/:replyId')
  async updateReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @CurrentUser() user: AuthUser,
    @Body() updateReplyDto: UpdateReplyDto,
  ) {
    return this.commentsService.updateReply(
      replyId,
      user,
      updateReplyDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('replies/:replyId')
  async deleteReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.commentsService.deleteReply(replyId, user);
  }
}
