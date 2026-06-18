import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    response.status(status).json({
      success: false,
      errorCode: this.getErrorCode(status),
      message: this.getMessage(exceptionResponse, status),
    });
  }

  private getMessage(response: unknown, status: number): string {
    if (response && typeof response === 'object') {
      const message = (response as Record<string, unknown>).message;

      if (Array.isArray(message)) {
        return message.join('\n');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    if (typeof response === 'string') {
      return response;
    }

    if (status === 500) {
      return '서버 오류가 발생했습니다.';
    }

    return '요청 처리 중 오류가 발생했습니다.';
  }

  private getErrorCode(status: number): string {
    const codes: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
    };

    return codes[status] ?? `HTTP_${status}`;
  }
}
