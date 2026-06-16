import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  name: string;
  methods?: string[];
  pathPattern: RegExp;
  windowMs: number;
  max: number;
};

const ONE_MINUTE_MS = 60_000;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly rules: RateLimitRule[];
  private lastCleanupAt = Date.now();

  constructor(private readonly configService: ConfigService) {
    this.rules = [
      {
        name: 'auth-sensitive',
        methods: ['POST'],
        pathPattern: /^\/api\/auth\/(?:login|signup|email-verification\/request)$/,
        windowMs: ONE_MINUTE_MS,
        max: parsePositiveInteger(
          this.configService.get<string>('RATE_LIMIT_AUTH_MAX'),
          10,
        ),
      },
      {
        name: 'auth-check',
        methods: ['GET'],
        pathPattern: /^\/api\/auth\/check-/,
        windowMs: ONE_MINUTE_MS,
        max: parsePositiveInteger(
          this.configService.get<string>('RATE_LIMIT_CHECK_MAX'),
          60,
        ),
      },
      {
        name: 'post-view',
        methods: ['POST'],
        pathPattern: /^\/api\/posts\/\d+\/view$/,
        windowMs: ONE_MINUTE_MS,
        max: parsePositiveInteger(
          this.configService.get<string>('RATE_LIMIT_VIEW_MAX'),
          60,
        ),
      },
      {
        name: 'write-actions',
        methods: ['POST', 'PATCH', 'DELETE'],
        pathPattern: /^\/api\/(?:posts|comments|bookmarks|follows|me)\b/,
        windowMs: ONE_MINUTE_MS,
        max: parsePositiveInteger(
          this.configService.get<string>('RATE_LIMIT_WRITE_MAX'),
          30,
        ),
      },
      {
        name: 'default',
        pathPattern: /^\/api\//,
        windowMs: ONE_MINUTE_MS,
        max: parsePositiveInteger(
          this.configService.get<string>('RATE_LIMIT_DEFAULT_MAX'),
          300,
        ),
      },
    ];
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const method = (request.method ?? 'GET').toUpperCase();
    const path = this.getPath(request);
    const rule = this.rules.find((candidate) => {
      if (candidate.methods && !candidate.methods.includes(method)) {
        return false;
      }

      return candidate.pathPattern.test(path);
    });

    if (!rule) {
      return true;
    }

    const now = Date.now();
    this.cleanupExpiredBuckets(now);

    const bucketKey = `${rule.name}:${this.getClientKey(request)}`;
    const bucket = this.buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(bucketKey, {
        count: 1,
        resetAt: now + rule.windowMs,
      });
      return true;
    }

    bucket.count += 1;

    if (bucket.count > rule.max) {
      throw new HttpException(
        'Too many requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getPath(request: RequestLike) {
    const rawPath = request.originalUrl ?? request.url ?? '/';
    return rawPath.split('?')[0] || '/';
  }

  private getClientKey(request: RequestLike) {
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }

  private cleanupExpiredBuckets(now: number) {
    if (now - this.lastCleanupAt < ONE_MINUTE_MS) {
      return;
    }

    this.lastCleanupAt = now;

    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
