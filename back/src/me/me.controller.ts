import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { GetMyBookmarksQueryDto } from './dto/get-my-bookmarks.query.dto';
import { GetMyCommentsQueryDto } from './dto/get-my-comments.query.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts.query.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { MeService } from './me.service';

type RequestWithUser = Request & {
  user: AuthUser;
};

@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  async getMe(@Req() request: RequestWithUser) {
    return this.meService.getMe(request.user.id);
  }

  @Patch('profile')
  async updateMyProfile(
    @Req() request: RequestWithUser,
    @Body() updateMyProfileDto: UpdateMyProfileDto,
  ) {
    return this.meService.updateMyProfile(request.user.id, updateMyProfileDto);
  }

  @Get('posts')
  async getMyPosts(
    @Req() request: RequestWithUser,
    @Query() query: GetMyPostsQueryDto,
  ) {
    return this.meService.getMyPosts(request.user.id, query);
  }

  @Get('bookmarks')
  async getMyBookmarks(
    @Req() request: RequestWithUser,
    @Query() query: GetMyBookmarksQueryDto,
  ) {
    return this.meService.getMyBookmarks(request.user.id, query);
  }

  @Get('comments')
  async getMyComments(
    @Req() request: RequestWithUser,
    @Query() query: GetMyCommentsQueryDto,
  ) {
    return this.meService.getMyComments(request.user.id, query);
  }

  @Get('follows')
  async getMyFollows(
    @Req() request: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.meService.getMyFollows(
      request.user.id,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }
}
