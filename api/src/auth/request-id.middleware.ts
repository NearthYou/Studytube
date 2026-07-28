import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { REQUEST_ID_MAX_CHARACTERS } from './auth.constants';

export type RequestWithId = {
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
};

export type ResponseWithRequestId = {
  setHeader(name: string, value: string): void;
};

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    request: RequestWithId,
    response: ResponseWithRequestId,
    next: () => void,
  ): void {
    const incoming = request.headers['x-request-id'];
    const requestId = isSafeRequestId(incoming) ? incoming : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    next();
  }
}

function isSafeRequestId(
  incoming: string | string[] | undefined,
): incoming is string {
  return (
    typeof incoming === 'string' &&
    incoming.length > 0 &&
    incoming.length <= REQUEST_ID_MAX_CHARACTERS &&
    SAFE_REQUEST_ID_PATTERN.test(incoming)
  );
}
