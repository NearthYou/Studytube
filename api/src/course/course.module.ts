import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DatabaseService } from '../database.service';
import { CourseController, PublicCourseController } from './course.controller';
import {
  CourseCutoverPolicy,
  resolveCourseCutoverMode,
} from './course-cutover.policy';
import { COURSE_REPOSITORY, type CourseRepository } from './course.repository';
import { CourseService } from './course.service';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [CourseController, PublicCourseController],
  providers: [
    {
      provide: CourseCutoverPolicy,
      useFactory: (config: ConfigService) =>
        new CourseCutoverPolicy(
          resolveCourseCutoverMode(
            config.get<string>('COURSE_CUTOVER_MODE'),
            config.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
          ),
        ),
      inject: [ConfigService],
    },
    {
      provide: COURSE_REPOSITORY,
      useFactory: (database: DatabaseService) => database.getCourseRepository(),
      inject: [DatabaseService],
    },
    {
      provide: CourseService,
      useFactory: (
        repository: CourseRepository,
        cutoverPolicy: CourseCutoverPolicy,
      ) => new CourseService(repository, cutoverPolicy),
      inject: [COURSE_REPOSITORY, CourseCutoverPolicy],
    },
  ],
  exports: [CourseCutoverPolicy, CourseService],
})
export class CourseModule {}
