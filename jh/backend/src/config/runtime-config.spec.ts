import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createCorsOptions,
  loadRuntimeEnv,
  validateRuntimeConfig,
} from './runtime-config';

const originalEnv = process.env;

describe('runtime config', () => {
  const productionJwtSecret =
    'tailtalk-production-jwt-secret-32-characters-minimum';

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('requires DATABASE_URL in every environment', () => {
    delete process.env.DATABASE_URL;

    expect(() => validateRuntimeConfig()).toThrow('DATABASE_URL is required.');
  });

  it('loads runtime env files before validation without overriding existing env', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tailtalk-env-'));
    const envPath = join(directory, '.env');

    try {
      process.env.DATABASE_URL =
        'postgres://existing:existing@localhost:5432/existing';
      delete process.env.JWT_SECRET;
      await writeFile(
        envPath,
        [
          'DATABASE_URL=postgres://file:file@localhost:5432/file',
          'JWT_SECRET=loaded-jwt-secret',
        ].join('\n'),
      );

      loadRuntimeEnv(envPath);

      expect(process.env.DATABASE_URL).toBe(
        'postgres://existing:existing@localhost:5432/existing',
      );
      expect(process.env.JWT_SECRET).toBe('loaded-jwt-secret');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects placeholder JWT secrets in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.FRONTEND_ORIGINS = 'https://example.com';
    process.env.JWT_SECRET = 'replace-with-a-long-random-secret';
    process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';

    expect(() => validateRuntimeConfig()).toThrow(
      'JWT_SECRET must be replaced for production.',
    );
  });

  it('rejects weak JWT secrets in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.FRONTEND_ORIGINS = 'https://example.com';
    process.env.JWT_SECRET = 'short-production-secret';
    process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';

    expect(() => validateRuntimeConfig()).toThrow(
      'JWT_SECRET must be at least 32 characters in production.',
    );
  });

  it('requires explicit acknowledgement for local uploads in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.FRONTEND_ORIGINS = 'https://example.com';
    process.env.JWT_SECRET = productionJwtSecret;
    process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';
    process.env.UPLOAD_STORAGE_DRIVER = 'local';
    delete process.env.ALLOW_LOCAL_UPLOADS_IN_PRODUCTION;

    expect(() => validateRuntimeConfig()).toThrow(
      'Production local upload storage requires absolute UPLOAD_LOCAL_ROOT backed by persistent shared storage',
    );
  });

  it('rejects relative persistent upload roots in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.FRONTEND_ORIGINS = 'https://example.com';
    process.env.JWT_SECRET = productionJwtSecret;
    process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';
    process.env.UPLOAD_STORAGE_DRIVER = 'local';
    process.env.UPLOAD_LOCAL_ROOT = 'uploads';
    process.env.UPLOAD_LOCAL_ROOT_IS_PERSISTENT = 'true';
    delete process.env.ALLOW_LOCAL_UPLOADS_IN_PRODUCTION;

    expect(() => validateRuntimeConfig()).toThrow(
      'Production local upload storage requires absolute UPLOAD_LOCAL_ROOT backed by persistent shared storage',
    );
  });

  it('rejects missing persistent upload roots in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.FRONTEND_ORIGINS = 'https://example.com';
    process.env.JWT_SECRET = productionJwtSecret;
    process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';
    process.env.UPLOAD_STORAGE_DRIVER = 'local';
    process.env.UPLOAD_LOCAL_ROOT = '/tmp/tailtalk-missing-persistent-root';
    process.env.UPLOAD_LOCAL_ROOT_IS_PERSISTENT = 'true';
    delete process.env.ALLOW_LOCAL_UPLOADS_IN_PRODUCTION;

    expect(() => validateRuntimeConfig()).toThrow(
      'Production UPLOAD_LOCAL_ROOT must exist and be writable.',
    );
  });

  it('allows production local uploads when backed by an acknowledged persistent root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tailtalk-uploads-'));

    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL =
        'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
      process.env.FRONTEND_ORIGINS = 'https://example.com';
      process.env.JWT_SECRET = productionJwtSecret;
      process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';
      process.env.UPLOAD_STORAGE_DRIVER = 'local';
      process.env.UPLOAD_LOCAL_ROOT = directory;
      process.env.UPLOAD_LOCAL_ROOT_IS_PERSISTENT = 'true';
      setProductionMailConfig();
      delete process.env.ALLOW_LOCAL_UPLOADS_IN_PRODUCTION;

      expect(() => validateRuntimeConfig()).not.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('requires SMTP config in production', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tailtalk-uploads-'));

    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL =
        'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
      process.env.FRONTEND_ORIGINS = 'https://example.com';
      process.env.JWT_SECRET = productionJwtSecret;
      process.env.TOUR_API_SERVICE_KEY = 'tour-api-key';
      process.env.UPLOAD_STORAGE_DRIVER = 'local';
      process.env.UPLOAD_LOCAL_ROOT = directory;
      process.env.UPLOAD_LOCAL_ROOT_IS_PERSISTENT = 'true';
      setProductionMailConfig();
      delete process.env.MAIL_HOST;

      expect(() => validateRuntimeConfig()).toThrow('MAIL_HOST is required.');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects invalid MAIL_SECURE values', () => {
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.MAIL_SECURE = 'yes';

    expect(() => validateRuntimeConfig()).toThrow(
      'MAIL_SECURE must be true or false.',
    );
  });

  it('rejects invalid upload public prefixes', () => {
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.UPLOAD_PUBLIC_PREFIX = 'uploads';

    expect(() => validateRuntimeConfig()).toThrow(
      'UPLOAD_PUBLIC_PREFIX must start with /.',
    );
  });

  it('rejects upload storage drivers that are not implemented', () => {
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.UPLOAD_STORAGE_DRIVER = 's3';

    expect(() => validateRuntimeConfig()).toThrow(
      'UPLOAD_STORAGE_DRIVER=s3 is not implemented.',
    );
  });

  it('validates partial social provider config', () => {
    process.env.DATABASE_URL =
      'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => validateRuntimeConfig()).toThrow(
      'GOOGLE social login config is incomplete.',
    );
  });

  it('allows configured local frontend origins', () => {
    delete process.env.FRONTEND_ORIGINS;
    const options = createCorsOptions();
    const callback = jest.fn();

    options.origin?.('http://localhost:5173', callback);
    options.origin?.('http://127.0.0.1:5175', callback);

    expect(callback).toHaveBeenNthCalledWith(1, null, true);
    expect(callback).toHaveBeenNthCalledWith(2, null, true);
  });

  it('rejects unknown frontend origins without throwing CORS errors', () => {
    process.env.FRONTEND_ORIGINS = 'https://pongki.shop';
    const options = createCorsOptions();
    const callback = jest.fn();

    options.origin?.('https://evil.example', callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });
});

function setProductionMailConfig() {
  process.env.MAIL_HOST = 'smtp.example.com';
  process.env.MAIL_PORT = '587';
  process.env.MAIL_SECURE = 'false';
  process.env.MAIL_USER = 'tailtalk';
  process.env.MAIL_PASSWORD = 'mail-password';
  process.env.MAIL_FROM = 'Tail Talk <noreply@pongki.shop>';
}
