import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

function makeContext(input: { ip?: string; email?: string }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip: input.ip,
        socket: { remoteAddress: input.ip },
        body: { email: input.email },
      }),
    }),
  } as ExecutionContext;
}

describe('LoginRateLimitGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('blocks repeated login attempts from the same client and email', () => {
    const guard = new LoginRateLimitGuard();
    const context = makeContext({
      ip: '127.0.0.1',
      email: 'User@example.com',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }

    expect(() => guard.canActivate(context)).toThrow(
      new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('allows login attempts again after the window expires', () => {
    const guard = new LoginRateLimitGuard();
    const context = makeContext({
      ip: '127.0.0.1',
      email: 'user@example.com',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }

    jest.advanceTimersByTime(60_001);

    expect(guard.canActivate(context)).toBe(true);
  });
});
