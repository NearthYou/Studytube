import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database.service';
import { AuthController } from './auth.controller';
import { AuthCookiePolicy } from './auth-cookie';
import { ClientAddressResolver } from './client-address.resolver';
import { PasswordHasher } from './password-hasher';
import { RequestIdMiddleware } from './request-id.middleware';
import { SessionGuard } from './session.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [
    DatabaseService,
    PasswordHasher,
    RequestIdMiddleware,
    Reflector,
    {
      provide: AuthCookiePolicy,
      useFactory: () =>
        new AuthCookiePolicy(
          process.env.NODE_ENV === 'production' ? 'production' : 'development',
        ),
    },
    {
      provide: ClientAddressResolver,
      useFactory: () =>
        new ClientAddressResolver({
          trustProxyOneHop: process.env.AUTH_TRUST_PROXY_ONE_HOP === 'true',
          environment: environment(),
          bindAddress: process.env.HOST,
        }),
    },
    {
      provide: AuthService,
      useFactory: async (
        repository: DatabaseService,
        passwordHasher: PasswordHasher,
      ) =>
        new AuthService({
          repository,
          passwordHasher,
          dummyPasswordHash: await passwordHasher.createDummyHash(),
          clock: () => new Date(),
          sleep: (milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
          verificationPepper: secret(
            'AUTH_VERIFICATION_PEPPER',
            'development-verification-pepper',
          ),
          rateLimitPepper: secret(
            'AUTH_RATE_LIMIT_PEPPER',
            'development-rate-limit-pepper',
          ),
          timing: {
            minimumDurationMs: integerEnvironment(
              'AUTH_MINIMUM_RESPONSE_MS',
              process.env.NODE_ENV === 'test' ? 0 : 250,
            ),
          },
          delivery: {
            sender: process.env.AUTH_EMAIL_SENDER ?? 'no-reply@studytube.local',
            publicOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
            templateVersion: 'v1',
            locale: 'en',
            subject: 'Verify your StudyTube email',
          },
          rateLimit: {
            windowSeconds: integerEnvironment(
              'AUTH_RATE_LIMIT_WINDOW_SECONDS',
              900,
            ),
            maxAttempts: integerEnvironment('AUTH_RATE_LIMIT_MAX_ATTEMPTS', 5),
          },
        }),
      inject: [DatabaseService, PasswordHasher],
    },
    SessionGuard,
  ],
  exports: [
    AuthCookiePolicy,
    AuthService,
    ClientAddressResolver,
    DatabaseService,
    RequestIdMiddleware,
    SessionGuard,
  ],
})
export class AuthModule {}

function environment(): 'development' | 'test' | 'production' {
  const value = process.env.NODE_ENV;
  if (value === 'test' || value === 'production') {
    return value;
  }
  return 'development';
}

function secret(name: string, developmentDefault: string): string {
  const value = process.env[name];
  if (value) {
    return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new RangeError(`${name} must be configured in production`);
  }
  return developmentDefault;
}

function integerEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return parsed;
}
