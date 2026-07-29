import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { HttpObservabilityMiddleware } from './http-observability.middleware';
import {
  createObservabilityRuntime,
  type ObservabilityRuntime,
} from './runtime';
import { StructuredJsonLogger } from './structured-logger';

describe('HttpObservabilityMiddleware', () => {
  it('records only the request path in logs and metrics', () => {
    const canary = 'CANARY_query_never_record';
    const lines: string[] = [];
    const baseRuntime = createObservabilityRuntime('http-test');
    const runtime: ObservabilityRuntime = {
      ...baseRuntime,
      logger: new StructuredJsonLogger({
        service: 'http-test',
        contextProvider: baseRuntime.traces,
        write: (line) => lines.push(line),
        clock: () => new Date('2026-07-30T00:00:00.000Z'),
      }),
    };
    const middleware = new HttpObservabilityMiddleware(runtime);
    const request = {
      headers: {},
      method: 'GET',
      originalUrl: `/search?query=${canary}`,
      url: `/search?query=${canary}`,
      path: '/search',
      route: { path: '/search' },
    } as unknown as Request;
    const response = new TestResponse();

    middleware.use(
      request,
      response as unknown as Response,
      () => void response.emit('finish'),
    );

    expect(lines).toHaveLength(1);
    const requestLog = lines[0];
    const metrics = runtime.registry.toPrometheus();
    expect(`${requestLog}\n${metrics}`).not.toContain(canary);
    expect(JSON.parse(requestLog)).toMatchObject({
      message: 'http_request_completed',
      method: 'GET',
      route: '/search',
      status_code: 200,
    });
    expect(metrics).toContain('route="/search"');
  });
});

class TestResponse extends EventEmitter {
  readonly statusCode = 200;

  setHeader(): this {
    return this;
  }
}
