import { Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { BigIntIdPipe } from '../common/pipes/bigint-id.pipe';
import { LikesService } from './likes.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post('posts/:postId/likes')
  likePost(
    @Param('postId', BigIntIdPipe) postId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.likesService.likePost(postId, user);
  }

  @Delete('posts/:postId/likes')
  unlikePost(
    @Param('postId', BigIntIdPipe) postId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.likesService.unlikePost(postId, user);
  }

  @Post('comments/:commentId/likes')
  likeComment(
    @Param('commentId', BigIntIdPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.likesService.likeComment(commentId, user);
  }

  @Delete('comments/:commentId/likes')
  unlikeComment(
    @Param('commentId', BigIntIdPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.likesService.unlikeComment(commentId, user);
  }
}
