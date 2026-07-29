import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { OBSERVABILITY_RUNTIME, type ObservabilityRuntime } from './runtime';

@Injectable()
export class HttpObservabilityMiddleware implements NestMiddleware {
  constructor(
    @Inject(OBSERVABILITY_RUNTIME)
    private readonly runtime: ObservabilityRuntime,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = performance.now();
    this.runtime.traces.runRequest(request.headers, () => {
      const trace = this.runtime.traces.current();
      if (trace) {
        request.headers['x-request-id'] = trace.requestId;
        response.setHeader('X-Request-ID', trace.requestId);
        response.setHeader(
          'Traceparent',
          `00-${trace.traceId}-${trace.spanId}-${trace.traceFlags}`,
        );
      }

      response.once('finish', () => {
        const durationMs = performance.now() - startedAt;
        this.runtime.metrics.httpRequest(
          request.method,
          request.originalUrl || request.url,
          response.statusCode,
          durationMs,
        );
        this.runtime.logger.info('http_request_completed', {
          method: request.method,
          route: request.originalUrl || request.url,
          status_code: response.statusCode,
          duration_ms: durationMs,
        });
      });
      next();
    });
  }
}
