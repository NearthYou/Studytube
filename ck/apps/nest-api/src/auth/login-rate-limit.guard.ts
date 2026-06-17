import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

type LoginAttemptBucket = {
  count: number;
  resetAt: number;
};

const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, LoginAttemptBucket>();

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      body?: { email?: string };
    }>();
    const now = Date.now();
    const key = this.buildKey(request);
    const current = this.attempts.get(key);

    if (!current || current.resetAt <= now) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
      });
      return true;
    }

    if (current.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.count += 1;
    return true;
  }

  private buildKey(request: {
    ip?: string;
    socket?: { remoteAddress?: string };
    body?: { email?: string };
  }) {
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown-ip';
    const email = request.body?.email?.trim().toLowerCase() ?? 'unknown-email';

    return `${ip}:${email}`;
  }
}
