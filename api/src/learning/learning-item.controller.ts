import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import type { AuthenticatedRequest } from '../auth/session.guard';
import {
  CreateLearningNoteDto,
  LearningContextParamDto,
  LearningNoteParamDto,
  StartLearningItemDto,
  UpdateLearningNoteDto,
} from './learning-item.dto';
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

@Controller('learning')
export class LearningItemController {
  constructor(
    private readonly service: LearningItemService,
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
