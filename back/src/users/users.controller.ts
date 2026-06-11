import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { GetUserPostsQueryDto } from './dto/get-user-posts.query.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userId')
  async getUserProfile(@Param('userId', ParseIntPipe) userId: number) {
    return this.usersService.getUserProfile(userId);
  }

  @Get(':userId/posts')
  async getUserPosts(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: GetUserPostsQueryDto,
  ) {
    return this.usersService.getUserPosts(userId, query);
  }
}
