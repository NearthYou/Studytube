import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from './auth/public.decorator';
import type { AuthenticatedRequest } from './auth/session.guard';
import { StudyBoardService } from './study-board.service';

@Controller()
export class StudyBoardController {
  constructor(private readonly studyBoardService: StudyBoardService) {}

  @Get('posts')
  listPosts(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.studyBoardService.listPosts(actorFrom(request), {
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Public()
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
  getPost(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.studyBoardService.getPost(actorFrom(request), Number(id));
  }

  @Post('posts')
  createPost(
    @Req() request: AuthenticatedRequest,
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
    return this.studyBoardService.createPost(actorFrom(request), body);
  }

  @Put('posts/:id')
  updatePost(
    @Req() request: AuthenticatedRequest,
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
    return this.studyBoardService.updatePost(
      actorFrom(request),
      Number(id),
      body,
    );
  }

  @Delete('posts/:id')
  deletePost(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.studyBoardService.deletePost(actorFrom(request), Number(id));
  }

  @Post('posts/:id/comments')
  addComment(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.studyBoardService.addComment(
      actorFrom(request),
      Number(id),
      body,
    );
  }

  @Delete('posts/:postId/comments/:commentId')
  deleteComment(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.studyBoardService.deleteComment(
      actorFrom(request),
      Number(postId),
      Number(commentId),
    );
  }

  @Get('playlists')
  listPlaylists(@Req() request: AuthenticatedRequest) {
    return this.studyBoardService.listPlaylists(actorFrom(request));
  }

  @Post('playlists')
  createPlaylist(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      title: string;
      description: string;
      postIds: number[];
    },
  ) {
    return this.studyBoardService.createPlaylist(actorFrom(request), body);
  }

  @Put('playlists/:id')
  updatePlaylist(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      postIds?: number[];
    },
  ) {
    return this.studyBoardService.updatePlaylist(
      actorFrom(request),
      Number(id),
      body,
    );
  }

  @Delete('playlists/:id')
  deletePlaylist(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.studyBoardService.deletePlaylist(
      actorFrom(request),
      Number(id),
    );
  }

  @Post('playlists/:id/items')
  addPlaylistItem(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { postId: number },
  ) {
    return this.studyBoardService.addPlaylistItem(
      actorFrom(request),
      Number(id),
      Number(body.postId),
    );
  }

  @Post('playlists/:id/feedback')
  addPlaylistFeedback(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { rating: number; body: string },
  ) {
    return this.studyBoardService.addPlaylistFeedback(
      actorFrom(request),
      Number(id),
      body,
    );
  }
}

function actorFrom(request: AuthenticatedRequest): { userId: number } {
  return Object.freeze({ userId: request.principal.userId });
}
