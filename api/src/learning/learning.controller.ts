import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/session.guard';
import {
  AgentRunParamDto,
  CourseStepParamDto,
  CreateAgentRunDto,
  ExpectedVersionDto,
  QuizParamDto,
  RecordProgressDto,
  SubmitQuizDto,
} from './learning.dto';
import { throwLearningHttpError } from './learning-error.mapper';
import { LearningNotFoundError } from './learning.errors';
import { LearningService } from './learning.service';

@Controller('learning')
export class LearningController {
  constructor(private readonly service: LearningService) {}

  @Post('agent-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', maxLength: 200 },
  })
  createRun(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateAgentRunDto,
  ) {
    return boundary(() =>
      this.service.createRun(request.principal.userId, idempotencyKey, body),
    );
  }

  @Get('agent-runs/:runId')
  getRun(
    @Req() request: AuthenticatedRequest,
    @Param() params: AgentRunParamDto,
  ) {
    return boundary(async () =>
      required(
        await this.service.getRun(request.principal.userId, params.runId),
      ),
    );
  }

  @Post('agent-runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRun(
    @Req() request: AuthenticatedRequest,
    @Param() params: AgentRunParamDto,
    @Body() body: ExpectedVersionDto,
  ) {
    return boundary(() =>
      this.service.cancelRun(
        request.principal.userId,
        params.runId,
        body.expectedVersion,
      ),
    );
  }

  @Post('agent-runs/:runId/retry')
  @HttpCode(HttpStatus.OK)
  retryRun(
    @Req() request: AuthenticatedRequest,
    @Param() params: AgentRunParamDto,
    @Body() body: ExpectedVersionDto,
  ) {
    return boundary(() =>
      this.service.retryRun(
        request.principal.userId,
        params.runId,
        body.expectedVersion,
      ),
    );
  }

  @Post('agent-runs/:runId/approve')
  @HttpCode(HttpStatus.OK)
  approveRun(
    @Req() request: AuthenticatedRequest,
    @Param() params: AgentRunParamDto,
    @Body() body: ExpectedVersionDto,
  ) {
    return boundary(() =>
      this.service.approveRun(
        request.principal.userId,
        params.runId,
        body.expectedVersion,
      ),
    );
  }

  @Post('course-steps/:stepId/progress')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', maxLength: 200 },
  })
  recordProgress(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseStepParamDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RecordProgressDto,
  ) {
    return boundary(() =>
      this.service.recordProgress(
        request.principal.userId,
        params.stepId,
        idempotencyKey,
        body,
      ),
    );
  }

  @Get('course-steps/:stepId/progress')
  getProgress(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseStepParamDto,
  ) {
    return boundary(async () =>
      required(
        await this.service.getProgress(request.principal.userId, params.stepId),
      ),
    );
  }

  @Get('course-steps/:stepId/quiz')
  getQuiz(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseStepParamDto,
  ) {
    return boundary(async () =>
      required(
        await this.service.getQuiz(request.principal.userId, params.stepId),
      ),
    );
  }

  @Post('quizzes/:quizId/attempts')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', maxLength: 200 },
  })
  submitQuiz(
    @Req() request: AuthenticatedRequest,
    @Param() params: QuizParamDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SubmitQuizDto,
  ) {
    return boundary(() =>
      this.service.submitQuiz(
        request.principal.userId,
        params.quizId,
        idempotencyKey,
        body,
      ),
    );
  }

  @Get('quizzes/:quizId/attempts')
  listQuizAttempts(
    @Req() request: AuthenticatedRequest,
    @Param() params: QuizParamDto,
  ) {
    return boundary(() =>
      this.service.listQuizAttempts(request.principal.userId, params.quizId),
    );
  }
}

async function boundary<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throwLearningHttpError(error);
  }
}

function required<T>(value: T | null): T {
  if (value === null) throw new LearningNotFoundError();
  return value;
}
