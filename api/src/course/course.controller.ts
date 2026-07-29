import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import type { AuthenticatedRequest } from '../auth/session.guard';
import {
  CourseIdParamDto,
  CourseVersionDto,
  CreateCourseDto,
  CreateCourseFeedbackDto,
  ListCoursesQueryDto,
  ReplaceCourseStepsDto,
  UpdateCourseDto,
} from './dto';
import { throwCourseHttpError } from './course-error.mapper';
import { CourseService } from './course.service';
import type {
  CreateCourseInput,
  ReplaceCourseStepsInput,
  UpdateCourseMetadataInput,
} from './course.types';

@Controller('courses')
export class CourseController {
  constructor(private readonly service: CourseService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateCourseDto,
  ) {
    return boundary(() =>
      this.service.createCourse(
        request.principal.userId,
        idempotencyKey,
        body as CreateCourseInput,
      ),
    );
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListCoursesQueryDto,
  ) {
    return boundary(() =>
      this.service.listOwnerCourses(
        request.principal.userId,
        query.cursor,
        query.limit,
      ),
    );
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param() params: CourseIdParamDto) {
    return boundary(() =>
      this.service.getOwnerCourse(request.principal.userId, params.id),
    );
  }

  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseIdParamDto,
    @Body() body: UpdateCourseDto,
  ) {
    return boundary(() =>
      this.service.updateMetadata(
        request.principal.userId,
        params.id,
        body as UpdateCourseMetadataInput,
      ),
    );
  }

  @Put(':id/steps')
  replaceSteps(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseIdParamDto,
    @Body() body: ReplaceCourseStepsDto,
  ) {
    return boundary(() =>
      this.service.replaceSteps(
        request.principal.userId,
        params.id,
        body as ReplaceCourseStepsInput,
      ),
    );
  }

  @Post(':id/publish')
  publish(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseIdParamDto,
    @Body() body: CourseVersionDto,
  ) {
    return boundary(() =>
      this.service.publish(
        request.principal.userId,
        params.id,
        body.expectedVersion,
      ),
    );
  }

  @Post(':id/archive')
  archive(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseIdParamDto,
    @Body() body: CourseVersionDto,
  ) {
    return boundary(() =>
      this.service.archive(
        request.principal.userId,
        params.id,
        body.expectedVersion,
      ),
    );
  }

  @Post(':id/feedback')
  feedback(
    @Req() request: AuthenticatedRequest,
    @Param() params: CourseIdParamDto,
    @Body() body: CreateCourseFeedbackDto,
  ) {
    return boundary(() =>
      this.service.addFeedback(request.principal.userId, params.id, body),
    );
  }
}

@Public()
@Controller('explore/courses')
export class PublicCourseController {
  constructor(private readonly service: CourseService) {}

  @Get()
  list(@Query() query: ListCoursesQueryDto) {
    return boundary(() =>
      this.service.listPublicCourses(query.cursor, query.limit),
    );
  }

  @Get(':id')
  get(@Param() params: CourseIdParamDto) {
    return boundary(() => this.service.getPublicCourse(params.id));
  }
}

async function boundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throwCourseHttpError(error);
  }
}
