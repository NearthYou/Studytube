import { AuthController } from './auth.controller';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './auth-cookie.utils';

describe('AuthController cookie responses', () => {
  const sessionResult = {
    accessToken: 'access.jwt',
    refreshToken: {
      value: 'session.secret',
      expiresAt: new Date(Date.now() + 60_000),
    },
    user: {
      id: '1',
      email: 'user@example.com',
      nickname: 'tester',
    },
  };

  function createResponse() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };
  }

  it('sets httpOnly auth cookies on login and returns only the user', async () => {
    const authService = {
      login: jest.fn().mockResolvedValue(sessionResult),
    };
    const controller = new AuthController(authService as never);
    const response = createResponse();

    await expect(
      controller.login(
        { email: 'user@example.com', password: 'password123' },
        { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as never,
        response as never,
      ),
    ).resolves.toEqual({ user: sessionResult.user });

    expect(response.cookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      'access.jwt',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'session.secret',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('clears auth cookies on logout', async () => {
    const authService = {
      logout: jest.fn().mockResolvedValue({ revoked: true }),
    };
    const controller = new AuthController(authService as never);
    const response = createResponse();

    await expect(
      controller.logout(
        { headers: { cookie: `${REFRESH_TOKEN_COOKIE}=session.secret` } } as never,
        response as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(response.clearCookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      expect.any(Object),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      expect.any(Object),
    );
  });

  it('starts a password reset request', async () => {
    const authService = {
      requestPasswordReset: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new AuthController(authService as never);

    await expect(
      controller.requestPasswordReset({ email: 'user@example.com' }),
    ).resolves.toEqual({ ok: true });
    expect(authService.requestPasswordReset).toHaveBeenCalledWith({
      email: 'user@example.com',
    });
  });

  it('confirms a password reset request', async () => {
    const authService = {
      confirmPasswordReset: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new AuthController(authService as never);

    await expect(
      controller.confirmPasswordReset({
        token: 'reset.secret',
        newPassword: 'newPassword123',
      }),
    ).resolves.toEqual({ ok: true });
    expect(authService.confirmPasswordReset).toHaveBeenCalledWith({
      token: 'reset.secret',
      newPassword: 'newPassword123',
    });
  });
});
