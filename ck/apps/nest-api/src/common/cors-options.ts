import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function createCorsOptions(originList?: string): CorsOptions {
  const origins = originList
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin: origins?.length ? origins : DEFAULT_FRONTEND_ORIGINS,
    credentials: true,
  };
}
