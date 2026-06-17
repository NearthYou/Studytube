import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

type RequestLog = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip?: string;
};

export function createRequestLoggingMiddleware(
  logger: (entry: RequestLog) => void = (entry) => console.log(JSON.stringify(entry)),
) {
  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const requestIdHeader = request.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader)
      ? requestIdHeader[0]
      : requestIdHeader || randomUUID();

    response.setHeader('x-request-id', requestId);
    response.on('finish', () => {
      logger({
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        ip: request.ip,
      });
    });

    next();
  };
}
