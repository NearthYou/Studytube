import { createRequestLoggingMiddleware } from './request-logging.middleware';

describe('request logging middleware', () => {
  it('sets and preserves request ids', () => {
    const logger = jest.fn();
    const middleware = createRequestLoggingMiddleware(logger);
    const responseListeners = new Map<string, () => void>();
    const request = {
      method: 'GET',
      originalUrl: '/health',
      headers: { 'x-request-id': 'request-123' },
      ip: '127.0.0.1',
    };
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn((event: string, callback: () => void) => {
        responseListeners.set(event, callback);
      }),
    };
    const next = jest.fn();

    middleware(request as never, response as never, next);
    responseListeners.get('finish')?.();

    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'request-123');
    expect(next).toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-123',
        method: 'GET',
        path: '/health',
        statusCode: 200,
      }),
    );
  });
});
