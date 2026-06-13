import type { NextFunction, Request, Response } from 'express';

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  max: number;
  name: string;
  test: (request: Request) => boolean;
};

const buckets = new Map<string, Bucket>();

export function createRateLimitMiddleware() {
  const windowMs = getNumberEnv('RATE_LIMIT_WINDOW_MS', 60_000);
  const rules: RateLimitRule[] = [
    {
      max: getNumberEnv('AUTH_RATE_LIMIT_MAX', 20),
      name: 'auth',
      test: (request) =>
        request.path.startsWith('/api/auth/login') ||
        request.path.startsWith('/api/auth/email-verification') ||
        request.path.startsWith('/api/auth/email/') ||
        request.path.startsWith('/api/auth/nickname/check'),
    },
    {
      max: getNumberEnv('UPLOAD_RATE_LIMIT_MAX', 20),
      name: 'upload',
      test: (request) =>
        request.method !== 'GET' &&
        (request.path.startsWith('/api/posts/images') ||
          request.path.startsWith('/api/auth/signup')),
    },
    {
      max: getNumberEnv('VIEW_RATE_LIMIT_MAX', 120),
      name: 'view',
      test: (request) =>
        request.method === 'POST' &&
        /^\/api\/posts\/\d+\/views$/.test(request.path),
    },
    {
      max: getNumberEnv('TOUR_API_RATE_LIMIT_MAX', 60),
      name: 'tour',
      test: (request) => request.path.startsWith('/api/pet-places'),
    },
    {
      max: getNumberEnv('AGENT_RATE_LIMIT_MAX', 40),
      name: 'agent',
      test: (request) => request.path.startsWith('/api/agent'),
    },
  ];

  return (request: Request, response: Response, next: NextFunction) => {
    const rule = rules.find((item) => item.test(request));

    if (!rule) {
      next();
      return;
    }

    const now = Date.now();
    const bucketKey = `${rule.name}:${getClientKey(request)}`;
    const bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;

    if (bucket.count > rule.max) {
      response.status(429).json({
        success: false,
        errorCode: 'TOO_MANY_REQUESTS',
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      });
      return;
    }

    next();
  };
}

function getClientKey(request: Request) {
  return (
    request.ip || request.headers['x-forwarded-for']?.toString() || 'unknown'
  );
}

function getNumberEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}
