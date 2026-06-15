type EnvironmentVariables = Record<string, string | undefined>;

const DEV_DATABASE_URL = 'postgresql://postgres:1234@localhost:5433/travel_app';
const LOCAL_URL_PREFIXES = ['http://localhost', 'http://127.0.0.1'];
const MIN_PROD_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_JWT_SECRETS = new Set([
  'dev-jwt-secret-change-me',
  'change-this-local-secret',
]);

export function validateEnvironment(
  config: EnvironmentVariables,
): EnvironmentVariables {
  if (config.NODE_ENV?.toLowerCase() !== 'production') {
    return config;
  }

  const missingKeys = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS'].filter(
    (key) => !config[key]?.trim(),
  );

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missingKeys.join(
        ', ',
      )}`,
    );
  }

  const databaseUrl = config.DATABASE_URL?.trim();
  if (
    databaseUrl === DEV_DATABASE_URL ||
    databaseUrl?.includes('YOUR_PASSWORD')
  ) {
    throw new Error('DATABASE_URL must be changed in production.');
  }

  const jwtSecret = config.JWT_SECRET?.trim();
  if (jwtSecret && PLACEHOLDER_JWT_SECRETS.has(jwtSecret)) {
    throw new Error('JWT_SECRET must be changed in production.');
  }

  if (jwtSecret && jwtSecret.length < MIN_PROD_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_PROD_JWT_SECRET_LENGTH} characters in production.`,
    );
  }

  const corsOrigins = config.CORS_ORIGINS?.split(',').map((origin) =>
    origin.trim(),
  );
  if (corsOrigins?.includes('*')) {
    throw new Error('CORS_ORIGINS cannot include * in production.');
  }

  const ragSyncEnabled =
    config.RAG_SYNC_ENABLED?.trim().toLowerCase() !== 'false';
  const aiBackBaseUrl = config.AI_BACK_BASE_URL?.trim();

  if (ragSyncEnabled && !aiBackBaseUrl) {
    throw new Error(
      'AI_BACK_BASE_URL is required in production when RAG sync is enabled.',
    );
  }

  if (aiBackBaseUrl && isLocalUrl(aiBackBaseUrl)) {
    throw new Error('AI_BACK_BASE_URL must not use localhost in production.');
  }

  return config;
}

function isLocalUrl(value: string): boolean {
  return LOCAL_URL_PREFIXES.some((prefix) =>
    value.toLowerCase().startsWith(prefix),
  );
}
