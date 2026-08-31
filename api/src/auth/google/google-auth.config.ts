export type GoogleAuthConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  attemptEncryptionKey: Buffer;
  attemptTtlMs: 600_000;
}>;

const DEVELOPMENT_KEY = Buffer.alloc(32, 23).toString('base64');

export function resolveGoogleAuthConfig(
  environment: NodeJS.ProcessEnv,
): GoogleAuthConfig {
  const production = environment.NODE_ENV === 'production';
  const clientId = environmentValue(
    environment,
    'GOOGLE_OAUTH_CLIENT_ID',
    production,
    'studytube-development-client-id',
  );
  const clientSecret = environmentValue(
    environment,
    'GOOGLE_OAUTH_CLIENT_SECRET',
    production,
    'studytube-development-client-secret',
  );
  const publicOrigin = normalizePublicOrigin(
    environmentValue(
      environment,
      'STUDYTUBE_PUBLIC_URL',
      production,
      'http://localhost:5173',
    ),
    production,
  );
  const encodedKey = environmentValue(
    environment,
    'GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY',
    production,
    DEVELOPMENT_KEY,
  );
  const attemptEncryptionKey = decodeEncryptionKey(encodedKey);
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim()
    ? normalizeRedirectUri(
        environment.GOOGLE_OAUTH_REDIRECT_URI,
        production,
        publicOrigin,
      )
    : production
      ? `${publicOrigin}/api/auth/google/callback`
      : 'http://localhost:3000/auth/google/callback';

  return Object.freeze({
    clientId,
    clientSecret,
    redirectUri,
    attemptEncryptionKey,
    attemptTtlMs: 600_000,
  });
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  required: boolean,
  fallback: string,
): string {
  const value = environment[name]?.trim();
  if (value) return value;
  if (required) throw new RangeError(`${name} must be configured`);
  return fallback;
}

function normalizePublicOrigin(value: string, requireHttps: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError('STUDYTUBE_PUBLIC_URL must be an HTTP origin');
  }
  if (
    (requireHttps
      ? url.protocol !== 'https:'
      : !['http:', 'https:'].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    value.replace(/\/$/u, '') !== url.origin
  ) {
    throw new RangeError('STUDYTUBE_PUBLIC_URL must be an HTTP origin');
  }
  return url.origin;
}

function normalizeRedirectUri(
  value: string,
  requireHttps: boolean,
  publicOrigin: string,
): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RangeError('GOOGLE_OAUTH_REDIRECT_URI must be a valid URL');
  }
  if (
    (requireHttps
      ? url.protocol !== 'https:'
      : !['http:', 'https:'].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (requireHttps && url.origin !== publicOrigin)
  ) {
    throw new RangeError(
      'GOOGLE_OAUTH_REDIRECT_URI must be a safe callback URL',
    );
  }
  return url.toString();
}

function decodeEncryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length !== 32 ||
    decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
  ) {
    throw new RangeError(
      'GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY must be a base64 32-byte key',
    );
  }
  return decoded;
}
