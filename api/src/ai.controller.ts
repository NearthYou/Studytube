import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from './auth/session.guard';
import { AiProxyService } from './ai-proxy.service';
import { LiveCaptionService } from './live-caption.service';
import {
  CaptureLiveCaptionChunkDto,
  FinalizeLiveCaptionsDto,
  LiveCaptionChunkResponseDto,
  LiveCaptionFinalizeResponseDto,
} from './live-caption.dto';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiProxyService: AiProxyService,
    private readonly liveCaptions: LiveCaptionService,
  ) {}

  @Post('live-captions/chunks')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LiveCaptionChunkResponseDto })
  captureLiveCaptionChunk(
    @Req() request: AuthenticatedRequest,
    @Body() body: CaptureLiveCaptionChunkDto,
  ) {
    return this.liveCaptions.capture(request.principal.userId, body);
  }

  @Post('live-captions/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LiveCaptionFinalizeResponseDto })
  finalizeLiveCaptions(
    @Req() request: AuthenticatedRequest,
    @Body() body: FinalizeLiveCaptionsDto,
  ) {
    return this.liveCaptions.finalize(request.principal.userId, body);
  }

  @Post('rag/recommend')
  recommend(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.aiProxyService.recommend(body, request.principal.userId);
  }

  @Post('mcp/youtube')
  lookupYoutube(@Body() body: unknown) {
    return this.aiProxyService.lookupYoutube(body);
  }

  @Post('youtube/captions')
  captions(@Body() body: unknown) {
    return this.aiProxyService.captions(body);
  }

  @Post('youtube/summary')
  summary(@Body() body: unknown) {
    return this.aiProxyService.summary(body);
  }

  @Post('agent/study-plan')
  plan(@Body() body: unknown) {
    return this.aiProxyService.plan(body);
  }
}
