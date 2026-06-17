import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CommentsService } from './comments.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('seat-reviews/:reviewId/comments')
  @UseGuards(JwtAuthGuard)
  create(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(reviewId, user, dto);
  }

  @Get('seat-reviews/:reviewId/comments')
  findBySeatReview(
    @Param('reviewId') reviewId: string,
    @Query() query: CommentQueryDto,
  ) {
    return this.commentsService.findBySeatReview(reviewId, query);
  }

  @Patch('comments/:id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.update(id, user, dto);
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.commentsService.remove(id, user);
  }

  @Post('comments/:id/like')
  @UseGuards(JwtAuthGuard)
  like(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.commentsService.like(id, user);
  }

  @Delete('comments/:id/like')
  @UseGuards(JwtAuthGuard)
  unlike(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.commentsService.unlike(id, user);
  }
}
