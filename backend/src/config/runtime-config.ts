import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { accessSync, constants, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  getUploadLocalRoot,
  normalizeUploadPublicPrefix,
} from '../common/upload/upload-paths';

const localFrontendOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
  'http://127.0.0.1:5177',
];

export function validateRuntimeConfig() {
  requireEnv('DATABASE_URL');

  if (process.env.NODE_ENV === 'production') {
    requireEnv('JWT_SECRET');
    requireEnv('FRONTEND_ORIGINS');
    requireEnv('TOUR_API_SERVICE_KEY');
    rejectPlaceholderSecret('JWT_SECRET', [
      'local-development-jwt-secret',
      'replace-with-a-long-random-secret',
    ]);
    validateProductionJwtSecret();
    validateProductionUploadStorage();
  }

  validateUploadStorageDriver();
  validateUploadPathConfig();
  validateSocialProviderPair('GOOGLE', true);
  validateSocialProviderPair('KAKAO', false);
  validateSocialProviderPair('NAVER', true);
}

export function loadRuntimeEnv(
  envFilePath = process.env.DOTENV_CONFIG_PATH?.trim() || '.env',
) {
  const resolvedPath = resolve(process.cwd(), envFilePath);

  if (!existsSync(resolvedPath)) {
    return;
  }

  loadDotenv({
    override: false,
    path: resolvedPath,
    quiet: true,
  });
}

export function createCorsOptions(): CorsOptions {
  const allowedOrigins = parseCsv(process.env.FRONTEND_ORIGINS);
  const origins =
    allowedOrigins.length > 0 ? allowedOrigins : localFrontendOrigins;

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin is not allowed'), false);
    },
  };
}

function requireEnv(key: string) {
  if (!process.env[key]?.trim()) {
    throw new Error(`${key} is required.`);
  }
}

function rejectPlaceholderSecret(key: string, placeholders: string[]) {
  const value = process.env[key]?.trim();

  if (value && placeholders.includes(value)) {
    throw new Error(`${key} must be replaced for production.`);
  }
}

function validateProductionJwtSecret() {
  const value = process.env.JWT_SECRET?.trim() ?? '';

  if (value.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }

  if (/^(.)\1+$/.test(value)) {
    throw new Error('JWT_SECRET must not use a repeated character pattern.');
  }
}

function validateUploadStorageDriver() {
  const storageDriver = getUploadStorageDriver();

  if (storageDriver !== 'local') {
    throw new Error(
      `UPLOAD_STORAGE_DRIVER=${storageDriver} is not implemented.`,
    );
  }
}

function validateProductionUploadStorage() {
  if (getUploadStorageDriver() !== 'local') {
    return;
  }

  const uploadLocalRoot = process.env.UPLOAD_LOCAL_ROOT?.trim() ?? '';
  const persistentLocalRoot =
    Boolean(uploadLocalRoot) &&
    isAbsolute(uploadLocalRoot) &&
    process.env.UPLOAD_LOCAL_ROOT_IS_PERSISTENT === 'true';
  const acceptedDemoLocalStorage =
    process.env.ALLOW_LOCAL_UPLOADS_IN_PRODUCTION === 'true';

  if (!persistentLocalRoot && !acceptedDemoLocalStorage) {
    throw new Error(
      'Production local upload storage requires absolute UPLOAD_LOCAL_ROOT backed by persistent shared storage and UPLOAD_LOCAL_ROOT_IS_PERSISTENT=true. Set ALLOW_LOCAL_UPLOADS_IN_PRODUCTION=true only for an accepted single-instance demo deployment.',
    );
  }

  if (persistentLocalRoot) {
    const uploadRoot = getUploadLocalRoot();

    try {
      accessSync(uploadRoot, constants.W_OK);
    } catch {
      throw new Error(
        'Production UPLOAD_LOCAL_ROOT must exist and be writable.',
      );
    }
  }
}

function getUploadStorageDriver() {
  return (process.env.UPLOAD_STORAGE_DRIVER ?? 'local').trim().toLowerCase();
}

function validateUploadPathConfig() {
  normalizeUploadPublicPrefix(process.env.UPLOAD_PUBLIC_PREFIX ?? '/uploads');
  getUploadLocalRoot();
}

function parseCsv(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateSocialProviderPair(
  prefix: 'GOOGLE' | 'KAKAO' | 'NAVER',
  requiresSecret: boolean,
) {
  const clientId =
    process.env[`${prefix}_CLIENT_ID`]?.trim() ||
    (prefix === 'KAKAO' ? process.env.KAKAO_REST_API_KEY?.trim() : '');
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();

  if (!clientId && !clientSecret) {
    return;
  }

  if (!clientId || (requiresSecret && !clientSecret)) {
    throw new Error(`${prefix} social login config is incomplete.`);
  }
}
