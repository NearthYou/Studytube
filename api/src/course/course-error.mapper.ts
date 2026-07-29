import { HttpStatus } from '@nestjs/common';
import { AuthHttpException } from '../auth/auth-http.exception';
import {
  CourseFeedbackRateLimitedError,
  CourseIdempotencyConflictError,
  CourseLifecycleError,
  CourseNotFoundError,
  CoursePersistenceUnavailableError,
  CourseValidationError,
  CourseVersionConflictError,
} from './course.errors';
import { CourseCutoverPolicyError } from './course-cutover.policy';

export function throwCourseHttpError(error: unknown): never {
  if (error instanceof CourseValidationError) {
    throw new AuthHttpException(
      error.code,
      error.message,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof CourseNotFoundError) {
    throw new AuthHttpException(
      error.code,
      'Course was not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (
    error instanceof CourseVersionConflictError ||
    error instanceof CourseIdempotencyConflictError ||
    error instanceof CourseLifecycleError
  ) {
    throw new AuthHttpException(error.code, error.message, HttpStatus.CONFLICT);
  }
  if (error instanceof CourseFeedbackRateLimitedError) {
    throw new AuthHttpException(
      error.code,
      'Too many feedback requests',
      HttpStatus.TOO_MANY_REQUESTS,
      error.retryAfterSeconds,
    );
  }
  if (
    error instanceof CoursePersistenceUnavailableError ||
    error instanceof CourseCutoverPolicyError
  ) {
    throw new AuthHttpException(
      'COURSE_SERVICE_UNAVAILABLE',
      'Course service is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  throw error;
}
