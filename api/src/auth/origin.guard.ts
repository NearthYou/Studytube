import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { normalizeHttpOrigin } from '../cors-options';

type GuardRequest = {
  method?: string;
  path?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(configuredOrigin: string) {
    const allowedOrigin = normalizeHttpOrigin(configuredOrigin);
    if (!allowedOrigin) {
      throw new RangeError('Exactly one valid web Origin is required');
    }
    this.allowedOrigin = allowedOrigin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const method = request.method?.toUpperCase() ?? '';
    if (method === 'OPTIONS' || !UNSAFE_METHODS.has(method)) {
      return true;
    }

    if (isMcpServiceBoundary(request)) {
      if (!isJsonContentType(request.headers?.['content-type'])) {
        throw new UnsupportedMediaTypeException(
          'State-changing requests require application/json',
        );
      }
      return true;
    }

    const origin = request.headers?.origin;
    if (
      typeof origin !== 'string' ||
      normalizeHttpOrigin(origin) !== this.allowedOrigin
    ) {
      throw new ForbiddenException('Request Origin is not allowed');
    }

    if (isBodylessLogout(request)) {
      return true;
    }
    if (!isJsonContentType(request.headers?.['content-type'])) {
      throw new UnsupportedMediaTypeException(
        'State-changing requests require application/json',
      );
    }
    return true;
  }
}

function isMcpServiceBoundary(request: GuardRequest): boolean {
  const path = request.path ?? request.url?.split('?', 1)[0] ?? '';
  return (
    request.method?.toUpperCase() === 'POST' &&
    (path === '/internal/mcp/search' || path === '/internal/mcp/tool-calls')
  );
}

function isJsonContentType(
  contentType: string | string[] | undefined,
): boolean {
  if (typeof contentType !== 'string') {
    return false;
  }
  return (
    contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  );
}

function isBodylessLogout(request: GuardRequest): boolean {
  const path = request.path ?? request.url?.split('?', 1)[0] ?? '';
  if (path !== '/auth/logout') {
    return false;
  }
  const contentLength = request.headers?.['content-length'];
  const transferEncoding = request.headers?.['transfer-encoding'];
  if (
    (contentLength !== undefined &&
      (typeof contentLength !== 'string' ||
        !/^\d+$/u.test(contentLength) ||
        Number(contentLength) !== 0)) ||
    transferEncoding !== undefined
  ) {
    return false;
  }
  return (
    request.body === undefined ||
    request.body === null ||
    (typeof request.body === 'object' &&
      !Array.isArray(request.body) &&
      Object.keys(request.body).length === 0)
  );
}
