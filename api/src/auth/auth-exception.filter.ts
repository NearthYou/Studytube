import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Argon2QueueOverflowError } from './argon2-work-limiter';
import { AuthRepositoryUnavailableError } from './auth.repository';
import { AuthHttpException } from './auth-http.exception';
import { ClientAddressResolutionError } from './client-address.resolver';
import { PasswordValidationError } from './password-hasher';
import type { RequestWithId } from './request-id.middleware';

type StableError = {
  code: string;
  message: string;
  requestId: string;
};

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & RequestWithId>();
    const mapped = mapException(exception);

    if (mapped.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(mapped.retryAfterSeconds));
    }

    const body: StableError = {
      code: mapped.code,
      message: mapped.message,
      requestId: request.requestId ?? 'unavailable',
    };
    response.status(mapped.status).json(body);
  }
}

function mapException(exception: unknown): {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
} {
  if (exception instanceof AuthHttpException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      retryAfterSeconds: exception.retryAfterSeconds,
    };
  }
  if (exception instanceof AuthRepositoryUnavailableError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service is temporarily unavailable',
    };
  }
  if (exception instanceof Argon2QueueOverflowError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service is temporarily unavailable',
      retryAfterSeconds: exception.retryAfterSeconds,
    };
  }
  if (
    exception instanceof PasswordValidationError ||
    exception instanceof ClientAddressResolutionError
  ) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_REQUEST',
      message: exception.message,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      code: codeForStatus(status),
      message: safeHttpMessage(exception),
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error',
  };
}

function safeHttpMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response === 'object' && response !== null) {
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    if (
      Array.isArray(message) &&
      message.every((item) => typeof item === 'string')
    ) {
      return message.join('; ');
    }
  }
  return exception.message || 'Request failed';
}

function codeForStatus(status: number): string {
  const codes: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'INVALID_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  };
  return codes[status] ?? 'REQUEST_FAILED';
}
