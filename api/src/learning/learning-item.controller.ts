import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/session.guard';
import {
  CreateLearningNoteDto,
  ExplainLearningSegmentDto,
  LearningContextParamDto,
  LearningNoteParamDto,
  StartLearningItemDto,
  UpdateLearningNoteDto,
} from './learning-item.dto';
import {
  InvalidLearningSegmentRangeError,
  LearningExplanationUnavailableError,
  LearningOverviewService,
} from './learning-overview.service';
import {
  LearningIntakeCompensationError,
  LearningItemService,
} from './learning-item.service';
import {
  LEARNING_NOTE_REPOSITORY,
  type LearningNoteRepository,
} from './learning-note.repository';
import { ProviderBudgetUnavailableError } from './provider-budget.repository';
import { InvalidYoutubeUrlError } from './youtube-url.policy';
import { observabilityRuntime } from '../observability';

@Controller('learning')
export class LearningItemController {
  constructor(
    private readonly service: LearningItemService,
    private readonly overview: LearningOverviewService,
    @Inject(LEARNING_NOTE_REPOSITORY)
    private readonly notes: LearningNoteRepository,
  ) {}

  @Post('items/intake')
  async start(
    @Req() request: AuthenticatedRequest,
    @Body() body: StartLearningItemDto,
  ) {
    try {
      return await this.service.start(request.principal.userId, body);
    } catch (error) {
      if (error instanceof InvalidYoutubeUrlError) {
        throw new BadRequestException({
          code: error.code,
          message: '지원되는 YouTube 주소를 입력해주세요.',
        });
      }
      if (error instanceof ProviderBudgetUnavailableError) {
        observabilityRuntime.metrics.learningEvent('reservation', 'denied');
        throw new ServiceUnavailableException({
          code: error.code,
          reason: error.reason,
          message:
            '현재 영상 처리를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.',
        });
      }
      if (error instanceof LearningIntakeCompensationError) {
        throw new ServiceUnavailableException({
          code: 'SERVICE_UNAVAILABLE',
          message:
            '학습 자료를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
        });
      }
      throw error;
    }
  }

  @Post('contexts/:contextId/notes')
  async createNote(
    @Req() request: AuthenticatedRequest,
    @Param() params: LearningContextParamDto,
    @Body() body: CreateLearningNoteDto,
  ) {
    const note = await this.notes.create({
      userId: request.principal.userId,
      studyContextId: params.contextId,
      positionSeconds: body.positionSeconds,
      body: body.body,
    });
    if (!note) throw new NotFoundException('학습 자료를 찾을 수 없습니다.');
    return note;
  }

  @Get('contexts/:contextId/captions')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: [
        'contextId',
        'generation',
        'phase',
        'sourceLanguage',
        'sourceSegments',
        'koreanSegments',
        'stale',
      ],
      properties: {
        contextId: { type: 'string' },
        generation: { type: 'integer', minimum: 0 },
        phase: {
          type: 'string',
          enum: [
            'source_pending',
            'transcription_pending',
            'translation_pending',
            'index_pending',
            'partial',
            'failed',
            'complete',
          ],
        },
        sourceLanguage: { type: 'string' },
        sourceSegments: { type: 'array', items: captionSegmentSchema() },
        koreanSegments: { type: 'array', items: captionSegmentSchema() },
        stale: { type: 'boolean', enum: [false] },
        errorCode: { type: 'string', nullable: true },
      },
    },
  })
  @ApiNotFoundResponse({ description: '학습 자료를 찾을 수 없습니다.' })
  async getCaptions(
    @Req() request: AuthenticatedRequest,
    @Param() params: LearningContextParamDto,
  ) {
    const snapshot = await this.service.getCaptions(
      request.principal.userId,
      params.contextId,
    );
    if (!snapshot) {
      throw new NotFoundException('학습 자료를 찾을 수 없습니다.');
    }
    observabilityRuntime.metrics.learningEvent('caption_stage', snapshot.phase);
    return snapshot;
  }

  @Get('contexts/:contextId/overview')
  @ApiOkResponse({ schema: learningOverviewSchema() })
  async getOverview(
    @Req() request: AuthenticatedRequest,
    @Param() params: LearningContextParamDto,
  ) {
    const overview = await this.overview.getOverview(
      request.principal.userId,
      params.contextId,
    );
    if (!overview) {
      throw new NotFoundException('학습 자료를 찾을 수 없습니다.');
    }
    return overview;
  }

  @Post('contexts/:contextId/explanations')
  @ApiOkResponse({ schema: learningExplanationSchema() })
  async explainSegment(
    @Req() request: AuthenticatedRequest,
    @Param() params: LearningContextParamDto,
    @Body() body: ExplainLearningSegmentDto,
  ) {
    try {
      const explanation = await this.overview.explainSegment(
        request.principal.userId,
        params.contextId,
        body,
      );
      if (!explanation) {
        throw new NotFoundException('이 구간의 자막을 찾을 수 없습니다.');
      }
      return explanation;
    } catch (error) {
      if (error instanceof InvalidLearningSegmentRangeError) {
        throw new BadRequestException('설명할 구간을 다시 선택해주세요.');
      }
      if (error instanceof LearningExplanationUnavailableError) {
        throw new ServiceUnavailableException(
          '지금은 이 문장을 설명할 수 없습니다. 잠시 후 다시 시도해주세요.',
        );
      }
      throw error;
    }
  }

  @Patch('contexts/:contextId/notes/:noteId')
  async updateNote(
    @Req() request: AuthenticatedRequest,
    @Param() params: LearningNoteParamDto,
    @Body() body: UpdateLearningNoteDto,
  ) {
    const note = await this.notes.update({
      userId: request.principal.userId,
      studyContextId: params.contextId,
      noteId: params.noteId,
      body: body.body,
    });
    if (!note) {
      throw new NotFoundException('메모를 찾을 수 없습니다.');
    }
    return note;
  }

  @Delete('contexts/:contextId/notes/:noteId')
  @HttpCode(HttpStatus.OK)
  async deleteNote(
    @Req() request: AuthenticatedRequest,
    @Param() params: LearningNoteParamDto,
  ) {
    const deleted = await this.notes.delete(
      request.principal.userId,
      params.contextId,
      params.noteId,
    );
    if (!deleted) throw new NotFoundException('메모를 찾을 수 없습니다.');
    return { deleted: true };
  }
}

function captionSegmentSchema() {
  return {
    type: 'object' as const,
    required: ['start', 'end', 'text'],
    properties: {
      start: { type: 'number' as const },
      end: { type: 'number' as const },
      text: { type: 'string' as const },
    },
  };
}

function learningOverviewSchema() {
  return {
    type: 'object' as const,
    required: ['contextId', 'status', 'coverage'],
    properties: {
      contextId: { type: 'string' as const },
      status: {
        type: 'string' as const,
        enum: ['pending', 'ready', 'failed'],
      },
      coverage: {
        type: 'object' as const,
        properties: {
          scope: { type: 'string' as const },
          startSeconds: { type: 'number' as const },
          endSeconds: { type: 'number' as const },
        },
      },
      summary: {
        type: 'object' as const,
        properties: {
          overview: { type: 'string' as const },
          chapters: { type: 'array' as const },
          takeaways: { type: 'array' as const },
        },
      },
      errorCode: { type: 'string' as const },
    },
  };
}

function learningExplanationSchema() {
  return {
    type: 'object' as const,
    required: ['plainMeaning', 'keyExpressions', 'contextNote', 'citation'],
    properties: {
      plainMeaning: { type: 'string' as const },
      keyExpressions: { type: 'array' as const },
      contextNote: { type: 'string' as const },
      citation: { type: 'object' as const },
    },
  };
}
