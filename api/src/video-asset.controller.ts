import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth/session.guard';
import { StudyBoardService } from './study-board.service';
import { VideoAssetService } from './video-asset.service';

@Controller('posts/:postId/video-asset')
export class VideoAssetController {
  constructor(
    private readonly studyBoardService: StudyBoardService,
    private readonly videoAssetService: VideoAssetService,
  ) {}

  @Get()
  getAsset(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ) {
    return this.studyBoardService.getVideoAsset(
      actorFrom(request),
      this.parsePostId(postId),
    );
  }

  @Post('prepare')
  async prepare(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ) {
    const parsedPostId = this.parsePostId(postId);
    const post = await this.studyBoardService.getOwnedPost(
      actorFrom(request),
      parsedPostId,
    );

    return this.videoAssetService.preparePostAssetRequest(post);
  }

  private parsePostId(postId: string): number {
    const parsed = Number(postId);

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('postId must be a positive integer');
    }

    return parsed;
  }
}

function actorFrom(request: AuthenticatedRequest): { userId: number } {
  return Object.freeze({ userId: request.principal.userId });
}
