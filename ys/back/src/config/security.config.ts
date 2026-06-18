import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';

const DEVELOPMENT_JWT_SECRET = 'dev-jwt-secret-change-me';
const MIN_PROD_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_JWT_SECRETS = new Set([
  DEVELOPMENT_JWT_SECRET,
  'change-this-local-secret',
]);
const DEFAULT_DEV_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
export const AUTH_COOKIE_NAME = 'tripy_access_token';

function isProduction(configService: ConfigService): boolean {
  return configService.get<string>('NODE_ENV')?.toLowerCase() === 'production';
}

function parseCsv(value?: string): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export function getJwtSecret(configService: ConfigService): string {
  const jwtSecret = configService.get<string>('JWT_SECRET')?.trim();

  if (jwtSecret) {
    if (isProduction(configService) && PLACEHOLDER_JWT_SECRETS.has(jwtSecret)) {
      throw new Error('JWT_SECRET must be changed in production.');
    }

    if (isProduction(configService) && jwtSecret.length < MIN_PROD_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_PROD_JWT_SECRET_LENGTH} characters in production.`,
      );
    }

    return jwtSecret;
  }

  if (isProduction(configService)) {
    throw new Error('JWT_SECRET is required in production.');
  }

  return DEVELOPMENT_JWT_SECRET;
}

export function getCorsOrigins(configService: ConfigService): string[] {
  const configuredOrigins = parseCsv(
    configService.get<string>('CORS_ORIGINS') ??
      configService.get<string>('FRONTEND_ORIGIN'),
  );

  if (configuredOrigins.length > 0) {
    if (
      isProduction(configService) &&
      configuredOrigins.some((origin) => origin === '*')
    ) {
      throw new Error('CORS_ORIGINS cannot include * in production.');
    }

    return configuredOrigins;
  }

  if (isProduction(configService)) {
    throw new Error('CORS_ORIGINS is required in production.');
  }

  return DEFAULT_DEV_CORS_ORIGINS;
}

export function getCorsOptions(configService: ConfigService): CorsOptions {
  return {
    origin: getCorsOrigins(configService),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  };
}

export function getAuthCookieOptions(configService: ConfigService) {
  const sameSite =
    configService.get<string>('AUTH_COOKIE_SAME_SITE') ??
    (isProduction(configService) ? 'none' : 'lax');
  const secure =
    configService.get<string>('AUTH_COOKIE_SECURE')?.toLowerCase() === 'true' ||
    isProduction(configService);
  const maxAge = Number(configService.get<string>('AUTH_COOKIE_MAX_AGE_MS'));

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: Number.isInteger(maxAge) && maxAge > 0 ? maxAge : 7 * 24 * 60 * 60 * 1000,
  };
}

export function getClearAuthCookieOptions(configService: ConfigService) {
  const cookieOptions: Partial<ReturnType<typeof getAuthCookieOptions>> = {
    ...getAuthCookieOptions(configService),
  };
  delete cookieOptions.maxAge;

  return cookieOptions;
}
