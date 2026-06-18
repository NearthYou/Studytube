import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { FollowsService } from './follows.service';

@Controller('users')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':userId/follow')
  async followUser(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.followsService.followUser(user.id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':userId/follow')
  async unfollowUser(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.followsService.unfollowUser(user.id, userId);
  }

  @Get(':userId/followers')
  async getFollowers(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.followsService.getFollowers(
      userId,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }

  @Get(':userId/followings')
  async getFollowings(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.followsService.getFollowings(
      userId,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }
}
