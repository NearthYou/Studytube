import { HttpException } from '@nestjs/common';

export class AuthHttpException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message, status);
  }
}
