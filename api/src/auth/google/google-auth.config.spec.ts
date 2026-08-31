import { resolveGoogleAuthConfig } from './google-auth.config';

const validEnvironment = {
  NODE_ENV: 'production',
  STUDYTUBE_PUBLIC_URL: 'https://studytube.page',
  GOOGLE_OAUTH_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
} satisfies NodeJS.ProcessEnv;

describe('resolveGoogleAuthConfig', () => {
  it.each([
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY',
    'STUDYTUBE_PUBLIC_URL',
  ] as const)('refuses production without %s', (name) => {
    const environment = { ...validEnvironment };
    delete environment[name];

    expect(() => resolveGoogleAuthConfig(environment)).toThrow(name);
  });

  it('derives the exact same-origin production callback', () => {
    const config = resolveGoogleAuthConfig(validEnvironment);

    expect(config).toEqual({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      redirectUri: 'https://studytube.page/api/auth/google/callback',
      attemptEncryptionKey: Buffer.alloc(32, 7),
      attemptTtlMs: 600_000,
    });
  });

  it.each([
    'http://studytube.page',
    'https://studytube.page/path',
    'https://user@studytube.page',
    'https://studytube.page?query=1',
  ])('rejects an unsafe production public URL: %s', (publicUrl) => {
    expect(() =>
      resolveGoogleAuthConfig({
        ...validEnvironment,
        STUDYTUBE_PUBLIC_URL: publicUrl,
      }),
    ).toThrow('STUDYTUBE_PUBLIC_URL');
  });

  it('requires an exact 32-byte encryption key', () => {
    expect(() =>
      resolveGoogleAuthConfig({
        ...validEnvironment,
        GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY: Buffer.alloc(31, 7).toString(
          'base64',
        ),
      }),
    ).toThrow('GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY');
  });
});
