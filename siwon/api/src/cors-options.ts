import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

export function createCorsOptions(configuredOrigins?: string): CorsOptions {
  const allowedOrigins = new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...parseConfiguredOrigins(configuredOrigins),
  ]);

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  };
}

function parseConfiguredOrigins(configuredOrigins?: string): string[] {
  return (configuredOrigins ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function isLocalDevOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

    return (
      parsed.protocol === 'http:' &&
      loopbackHosts.has(parsed.hostname) &&
      Boolean(parsed.port)
    );
  } catch {
    return false;
  }
}
