import { HttpStatus } from '@nestjs/common';
import { AuthHttpException } from '../auth/auth-http.exception';
import {
  LearningAttemptLimitError,
  LearningIdempotencyConflictError,
  LearningLeaseLostError,
  LearningLifecycleError,
  LearningNotFoundError,
  LearningPersistenceUnavailableError,
  LearningValidationError,
  LearningVersionConflictError,
} from './learning.errors';

export function throwLearningHttpError(error: unknown): never {
  if (error instanceof LearningValidationError) {
    throw new AuthHttpException(
      error.code,
      error.message,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof LearningNotFoundError) {
    throw new AuthHttpException(
      error.code,
      'Learning resource was not found',
      HttpStatus.NOT_FOUND,
    );
  }
  if (
    error instanceof LearningVersionConflictError ||
    error instanceof LearningIdempotencyConflictError ||
    error instanceof LearningLifecycleError ||
    error instanceof LearningLeaseLostError
  ) {
    throw new AuthHttpException(error.code, error.message, HttpStatus.CONFLICT);
  }
  if (error instanceof LearningAttemptLimitError) {
    throw new AuthHttpException(
      error.code,
      error.message,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof LearningPersistenceUnavailableError) {
    throw new AuthHttpException(
      error.code,
      'Learning service is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  throw error;
}
