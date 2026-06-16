import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { GetMyBookmarksQueryDto } from './dto/get-my-bookmarks.query.dto';
import { GetMyCommentsQueryDto } from './dto/get-my-comments.query.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts.query.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { VerifyCurrentPasswordDto } from './dto/verify-current-password.dto';
import { MeService } from './me.service';

@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  async getMe(@CurrentUser() user: AuthUser) {
    return this.meService.getMe(user.id);
  }

  @Patch('profile')
  async updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body() updateMyProfileDto: UpdateMyProfileDto,
  ) {
    return this.meService.updateMyProfile(user.id, updateMyProfileDto);
  }

  @Post('profile/password/verify')
  @HttpCode(200)
  async verifyCurrentPassword(
    @CurrentUser() user: AuthUser,
    @Body() verifyCurrentPasswordDto: VerifyCurrentPasswordDto,
  ) {
    return this.meService.verifyCurrentPassword(
      user.id,
      verifyCurrentPasswordDto.currentPassword,
    );
  }

  @Get('posts')
  async getMyPosts(
    @CurrentUser() user: AuthUser,
    @Query() query: GetMyPostsQueryDto,
  ) {
    return this.meService.getMyPosts(user.id, query);
  }

  @Get('bookmarks')
  async getMyBookmarks(
    @CurrentUser() user: AuthUser,
    @Query() query: GetMyBookmarksQueryDto,
  ) {
    return this.meService.getMyBookmarks(user.id, query);
  }

  @Get('comments')
  async getMyComments(
    @CurrentUser() user: AuthUser,
    @Query() query: GetMyCommentsQueryDto,
  ) {
    return this.meService.getMyComments(user.id, query);
  }

  @Get('follows')
  async getMyFollows(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.meService.getMyFollows(
      user.id,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }
}
