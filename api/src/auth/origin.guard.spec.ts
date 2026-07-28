import type { ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { OriginGuard } from './origin.guard';
import {
  RequestIdMiddleware,
  type RequestWithId,
  type ResponseWithRequestId,
} from './request-id.middleware';

describe('OriginGuard', () => {
  const guard = new OriginGuard('https://app.studytube.example');

  it('allows safe methods without an Origin header', () => {
    expect(guard.canActivate(contextFor({ method: 'GET' }))).toBe(true);
  });

  it('allows OPTIONS without treating it as a state mutation', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'OPTIONS',
          origin: 'https://evil.example',
        }),
      ),
    ).toBe(true);
  });

  it('allows an unsafe JSON request from the one exact configured Origin', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          origin: 'https://app.studytube.example',
          contentType: 'application/json; charset=utf-8',
          contentLength: '2',
        }),
      ),
    ).toBe(true);
  });

  it.each([
    undefined,
    'null',
    'not a url',
    'https://app.studytube.example.evil.test',
    'https://app.studytube.example, https://evil.example',
    ['https://app.studytube.example', 'https://evil.example'],
  ])('rejects an unsafe request with an invalid Origin: %p', (origin) => {
    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'POST',
          origin,
          contentType: 'application/json',
          contentLength: '2',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects non-JSON unsafe request bodies', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'PATCH',
          origin: 'https://app.studytube.example',
          contentType: 'application/x-www-form-urlencoded',
          contentLength: '7',
        }),
      ),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('permits the bodyless logout content-type exception only', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/auth/logout',
          origin: 'https://app.studytube.example',
          contentLength: '0',
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/auth/login',
          origin: 'https://app.studytube.example',
          contentLength: '0',
        }),
      ),
    ).toThrow(UnsupportedMediaTypeException);
  });
});

describe('RequestIdMiddleware', () => {
  it('preserves one bounded ASCII-safe request ID on request and response', () => {
    const middleware = new RequestIdMiddleware();
    const request = requestWithId('trace_01.example:child');
    const response = new CapturingRequestIdResponse();
    const next = jest.fn();

    middleware.use(request, response, next);

    expect(request.requestId).toBe('trace_01.example:child');
    expect(response.headers.get('x-request-id')).toBe('trace_01.example:child');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    '',
    'contains space',
    'line\r\ninjection',
    'é',
    'a'.repeat(129),
    ['one', 'two'],
  ])('generates a UUID for an unsafe incoming request ID: %p', (incoming) => {
    const request = requestWithId(incoming);
    const response = new CapturingRequestIdResponse();

    new RequestIdMiddleware().use(request, response, () => undefined);

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.headers.get('x-request-id')).toBe(request.requestId);
  });
});

type OriginInput = {
  method: string;
  path?: string;
  origin?: string | string[];
  contentType?: string;
  contentLength?: string;
};

function contextFor(input: OriginInput): ExecutionContext {
  const headers: Record<string, string | string[] | undefined> = {
    origin: input.origin,
    'content-type': input.contentType,
    'content-length': input.contentLength,
  };
  const request = {
    method: input.method,
    path: input.path ?? '/auth/signup',
    headers,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

function requestWithId(incoming: string | string[]): RequestWithId {
  return {
    headers: {
      'x-request-id': incoming,
    },
  };
}

class CapturingRequestIdResponse implements ResponseWithRequestId {
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
}
