import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { UpdatePostDto } from './dto/update-post.dto';
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

  @UseGuards(JwtAuthGuard)
  @Patch(':postId')
  async updatePost(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: RequestWithUser,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.updatePost(postId, request.user, updatePostDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':postId')
  async deletePost(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: RequestWithUser,
  ) {
    return this.postsService.deletePost(postId, request.user);
  }

  @Post(':postId/view')
  async incrementViewCount(
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.postsService.incrementViewCount(postId);
  }
}
