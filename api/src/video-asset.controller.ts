import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
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
    @Headers('authorization') authorization: string | undefined,
    @Param('postId') postId: string,
  ) {
    return this.studyBoardService.getVideoAsset(
      authorization,
      this.parsePostId(postId),
    );
  }

  @Post('prepare')
  async prepare(
    @Headers('authorization') authorization: string | undefined,
    @Param('postId') postId: string,
  ) {
    const parsedPostId = this.parsePostId(postId);
    const post = await this.studyBoardService.getOwnedPost(
      authorization,
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
