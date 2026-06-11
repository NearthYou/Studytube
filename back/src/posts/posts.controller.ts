import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsQueryDto } from './dto/get-posts.query.dto';
import { PostsService } from './posts.service';

type RequestWithUser = Request & {
  user: AuthUser;
};

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  async getPosts(@Query() query: GetPostsQueryDto) {
    return this.postsService.getPosts(query);
  }

  @Get(':postId')
  async getPostById(@Param('postId', ParseIntPipe) postId: number) {
    return this.postsService.getPostById(postId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createPost(
    @Req() request: RequestWithUser,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postsService.createPost(request.user, createPostDto);
  }

  @Post(':postId/view')
  async incrementViewCount(
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.postsService.incrementViewCount(postId);
  }
}
