import {
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { BookmarksService } from './bookmarks.service';

@Controller('posts')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':postId/bookmark')
  async addBookmark(
    @Param('postId', ParseIntPipe) postId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookmarksService.addBookmark(user.id, postId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':postId/bookmark')
  async removeBookmark(
    @Param('postId', ParseIntPipe) postId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookmarksService.removeBookmark(user.id, postId);
  }
}
