import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function createCorsOptions(configuredOrigin?: string): CorsOptions {
  const allowedOrigin = parseConfiguredOrigin(configuredOrigin);

  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, origin === allowedOrigin);
    },
  };
}

function parseConfiguredOrigin(configuredOrigin?: string): string {
  if (!configuredOrigin) {
    throw new RangeError('Exactly one web Origin is required');
  }
  if (configuredOrigin.includes(',')) {
    throw new RangeError('Exactly one web Origin is required');
  }
  try {
    const parsed = new URL(configuredOrigin);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== configuredOrigin
    ) {
      throw new RangeError('Configured web Origin must be canonical');
    }
    return parsed.origin;
  } catch {
    throw new RangeError('Configured web Origin is invalid');
  }
}
