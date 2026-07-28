import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

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
    this.allowedOrigin = parseConfiguredOrigin(configuredOrigin);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const method = request.method?.toUpperCase() ?? '';
    if (method === 'OPTIONS' || !UNSAFE_METHODS.has(method)) {
      return true;
    }

    const origin = request.headers?.origin;
    if (
      typeof origin !== 'string' ||
      parseRequestOrigin(origin) !== this.allowedOrigin
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

function parseConfiguredOrigin(configuredOrigin: string): string {
  const parsed = parseOrigin(configuredOrigin);
  if (!parsed || parsed !== configuredOrigin) {
    throw new RangeError('Exactly one canonical web Origin is required');
  }
  return parsed;
}

function parseRequestOrigin(origin: string): string | undefined {
  if (origin === 'null') {
    return undefined;
  }
  const parsed = parseOrigin(origin);
  return parsed === origin ? parsed : undefined;
}

function parseOrigin(origin: string): string | undefined {
  if (origin.length === 0 || origin.includes(',')) {
    return undefined;
  }
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
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
