import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

interface MessagePayload {
  message?: unknown;
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data) => this.wrapResponse(data)));
  }

  private wrapResponse(data: unknown) {
    if (this.isAlreadyWrapped(data)) {
      return data;
    }

    const message = this.getMessage(data);

    return {
      success: true,
      data,
      message,
    };
  }

  private isAlreadyWrapped(data: unknown): boolean {
    return (
      !!data &&
      typeof data === 'object' &&
      'success' in data &&
      'data' in data &&
      'message' in data
    );
  }

  private getMessage(data: unknown): string {
    if (data && typeof data === 'object') {
      const message = (data as MessagePayload).message;

      if (typeof message === 'string') {
        return message;
      }
    }

    return '요청이 성공했습니다.';
  }
}
