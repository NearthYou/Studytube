import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { StudyBoardService } from './study-board.service';

@Controller()
export class StudyBoardController {
  constructor(private readonly studyBoardService: StudyBoardService) {}

  @Post('auth/signup')
  signUp(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
    },
  ) {
    return this.studyBoardService.signUp(body);
  }

  @Post('auth/login')
  login(
    @Body()
    body: {
      email: string;
      password: string;
    },
  ) {
    return this.studyBoardService.login(body);
  }

  @Post('auth/demo')
  demoSession() {
    return this.studyBoardService.demoSession();
  }

  @Get('me')
  getMe(@Headers('authorization') authorization: string | undefined) {
    return this.studyBoardService.getMe(authorization);
  }

  @Put('me')
  updateMe(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      currentPassword?: string;
      name?: string;
      password?: string;
      preferences?: {
        interests: string[];
        pace: string;
        goal: string;
      };
    },
  ) {
    return this.studyBoardService.updateMe(authorization, body);
  }

  @Get('posts')
  listPosts(
    @Headers('authorization') authorization: string | undefined,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.studyBoardService.listPosts({
      token: authorization,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('explore/posts')
  listPublicPosts(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.studyBoardService.listPublicPosts({
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('posts/:id')
  getPost(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.studyBoardService.getPost(authorization, Number(id));
  }

  @Post('posts')
  createPost(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      title: string;
      videoUrl: string;
      thumbnailUrl?: string;
      channelName?: string;
      summary: string;
      translatedNotes: string;
      tags: string[];
    },
  ) {
    return this.studyBoardService.createPost(authorization, body);
  }

  @Put('posts/:id')
  updatePost(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      videoUrl?: string;
      thumbnailUrl?: string;
      channelName?: string;
      summary?: string;
      translatedNotes?: string;
      tags?: string[];
    },
  ) {
    return this.studyBoardService.updatePost(authorization, Number(id), body);
  }

  @Delete('posts/:id')
  deletePost(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.studyBoardService.deletePost(authorization, Number(id));
  }

  @Post('posts/:id/comments')
  addComment(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.studyBoardService.addComment(authorization, Number(id), body);
  }

  @Get('playlists')
  listPlaylists(@Headers('authorization') authorization?: string) {
    return this.studyBoardService.listPlaylists(authorization);
  }

  @Post('playlists')
  createPlaylist(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      title: string;
      description: string;
      postIds: number[];
    },
  ) {
    return this.studyBoardService.createPlaylist(authorization, body);
  }

  @Post('playlists/:id/items')
  addPlaylistItem(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { postId: number },
  ) {
    return this.studyBoardService.addPlaylistItem(
      authorization,
      Number(id),
      Number(body.postId),
    );
  }

  @Post('playlists/:id/feedback')
  addPlaylistFeedback(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { rating: number; body: string },
  ) {
    return this.studyBoardService.addPlaylistFeedback(
      authorization,
      Number(id),
      body,
    );
  }
}
