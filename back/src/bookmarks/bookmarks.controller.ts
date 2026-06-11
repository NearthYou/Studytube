import {
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { BookmarksService } from './bookmarks.service';

type RequestWithUser = Request & {
  user: AuthUser;
};

@Controller('posts')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':postId/bookmark')
  async addBookmark(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: RequestWithUser,
  ) {
    return this.bookmarksService.addBookmark(request.user.id, postId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':postId/bookmark')
  async removeBookmark(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: RequestWithUser,
  ) {
    return this.bookmarksService.removeBookmark(request.user.id, postId);
  }
}
