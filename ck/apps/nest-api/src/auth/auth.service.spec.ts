import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import {
  buildRefreshCookieValue,
  parseRefreshCookieValue,
} from './auth-cookie.utils';

describe('AuthService session security', () => {
  const futureDate = new Date(Date.now() + 60_000);

  function createService(overrides?: {
    usersService?: Record<string, jest.Mock>;
    jwtService?: Record<string, jest.Mock>;
    prisma?: Record<string, unknown>;
    configService?: Record<string, jest.Mock>;
  }) {
    const usersService = overrides?.usersService ?? {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      toPublicUser: jest.fn((user) => ({
        id: user.id.toString(),
        email: user.email,
        nickname: user.nickname,
      })),
    };

    const jwtService = overrides?.jwtService ?? {
      signAsync: jest.fn().mockResolvedValue('access.jwt'),
    };

    const prisma = overrides?.prisma ?? {
      authSession: {
        create: jest.fn(({ data }) => ({
          id: data.id,
          userId: data.userId,
          expiresAt: data.expiresAt,
        })),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
      $transaction: jest.fn((queries: unknown[]) => Promise.all(queries)),
    };

    const configService = overrides?.configService ?? {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    };

    return {
      service: new AuthService(
        usersService as never,
        jwtService as never,
        prisma as never,
        configService as never,
      ),
      usersService,
      jwtService,
      prisma,
      configService,
    };
  }

  it('creates a server-side refresh session during login', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    const { service, usersService, prisma } = createService();
    usersService.findByEmail.mockResolvedValue({
      id: 1n,
      email: 'user@example.com',
      nickname: 'tester',
      passwordHash,
    });

    const result = await service.login(
      { email: 'user@example.com', password: 'password123' },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result).toMatchObject({
      accessToken: 'access.jwt',
      user: {
        id: '1',
        email: 'user@example.com',
        nickname: 'tester',
      },
    });
    expect(parseRefreshCookieValue(result.refreshToken.value)).toEqual({
      sessionId: expect.any(String),
      secret: expect.any(String),
    });
    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        userId: 1n,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('creates an account and refresh session during Google login', async () => {
    const { service, usersService, prisma } = createService();
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockImplementation(
      ({ email, passwordHash, nickname }) => ({
        id: 7n,
        email,
        passwordHash,
        nickname,
      }),
    );

    const result = await service.loginWithGoogle(
      {
        email: 'GoogleUser@example.com',
        emailVerified: true,
        name: 'Google User',
      },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(usersService.create).toHaveBeenCalledWith({
      email: 'googleuser@example.com',
      passwordHash: expect.any(String),
      nickname: 'Google User',
    });
    expect(result).toMatchObject({
      accessToken: 'access.jwt',
      user: {
        id: '7',
        email: 'googleuser@example.com',
        nickname: 'Google User',
      },
    });
    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7n,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
    });
  });

  it('rejects Google login when the email is not verified', async () => {
    const { service, usersService } = createService();

    await expect(
      service.loginWithGoogle({
        email: 'user@example.com',
        emailVerified: false,
      }),
    ).rejects.toThrow('Google account email is not verified');
    expect(usersService.findByEmail).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token and replaces the stored secret hash', async () => {
    const oldSecret = 'old-refresh-secret';
    const storedHash = await bcrypt.hash(oldSecret, 4);
    const { service, prisma } = createService();
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 1n,
      refreshTokenHash: storedHash,
      expiresAt: futureDate,
      revokedAt: null,
      user: {
        id: 1n,
        email: 'user@example.com',
        nickname: 'tester',
      },
    });

    const result = await service.refresh(
      buildRefreshCookieValue('session-1', oldSecret),
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.accessToken).toBe('access.jwt');
    expect(parseRefreshCookieValue(result.refreshToken.value)).toMatchObject({
      sessionId: 'session-1',
      secret: expect.any(String),
    });
    expect(parseRefreshCookieValue(result.refreshToken.value)?.secret).not.toBe(
      oldSecret,
    );
    expect(prisma.authSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        refreshTokenHash: expect.any(String),
        lastUsedAt: expect.any(Date),
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
    });
  });

  it('revokes the server session during logout', async () => {
    const { service, prisma } = createService();

    await service.logout(buildRefreshCookieValue('session-1', 'secret'));

    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('creates a password reset token for an existing user', async () => {
    const { service, usersService, prisma } = createService();
    usersService.findByEmail.mockResolvedValue({
      id: 1n,
      email: 'user@example.com',
      nickname: 'tester',
    });
    prisma.passwordResetToken.create.mockImplementation(({ data }) => ({
      id: data.id,
      userId: data.userId,
      expiresAt: data.expiresAt,
    }));

    const result = await service.requestPasswordReset({
      email: 'user@example.com',
    });

    expect(result).toEqual({
      ok: true,
      resetToken: expect.any(String),
    });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        userId: 1n,
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('does not reveal whether a password reset email exists', async () => {
    const { service, usersService, prisma } = createService();
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.requestPasswordReset({ email: 'missing@example.com' }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('uses a valid password reset token and revokes existing sessions', async () => {
    const secret = 'reset-secret';
    const tokenHash = await bcrypt.hash(secret, 4);
    const { service, prisma } = createService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 1n,
      tokenHash,
      expiresAt: futureDate,
      usedAt: null,
    });

    await service.confirmPasswordReset({
      token: 'reset-1.reset-secret',
      newPassword: 'newPassword123',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { passwordHash: expect.any(String) },
    });
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'reset-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 1n, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
  });
});
