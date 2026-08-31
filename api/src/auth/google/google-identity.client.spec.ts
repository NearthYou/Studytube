import { createHash } from 'node:crypto';
import {
  OfficialGoogleIdentityClient,
  type GoogleOAuthClientPort,
} from './google-identity.client';

const completePayload = {
  iss: 'https://accounts.google.com',
  aud: 'client-id.apps.googleusercontent.com',
  sub: 'google-subject-1',
  email: 'learner@example.com',
  email_verified: true,
  name: 'Learner',
  picture: 'https://example.com/avatar.png',
  nonce: 'expected-nonce',
  iat: 1_788_000_000,
  exp: 1_788_003_600,
};

describe('OfficialGoogleIdentityClient', () => {
  it('builds a bounded authorization URL with PKCE and no offline access', () => {
    const port = oauthPort(completePayload);
    const client = new OfficialGoogleIdentityClient(config(), port);

    const url = new URL(
      client.authorizationUrl({
        state: 'state-value',
        nonce: 'nonce-value',
        codeChallenge: 'challenge-value',
      }),
    );

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('access_type')).toBe(false);
  });

  it('returns only a verified identity and discards provider tokens', async () => {
    const port = oauthPort(completePayload);
    const client = new OfficialGoogleIdentityClient(config(), port);

    await expect(
      client.exchange({
        code: 'one-use-code',
        codeVerifier: 'pkce-verifier',
        expectedNonceDigest: digest('expected-nonce'),
      }),
    ).resolves.toEqual({
      subject: 'google-subject-1',
      email: 'learner@example.com',
      emailVerified: true,
      name: 'Learner',
      pictureUrl: 'https://example.com/avatar.png',
    });
  });

  it.each([
    ['subject', { ...completePayload, sub: undefined }],
    ['verified email flag', { ...completePayload, email_verified: false }],
    ['nonce', { ...completePayload, nonce: 'another-nonce' }],
    ['email', { ...completePayload, email: undefined }],
  ] as const)(
    'rejects an identity with an invalid %s claim',
    async (_label, payload) => {
      const client = new OfficialGoogleIdentityClient(
        config(),
        oauthPort(payload),
      );

      await expect(
        client.exchange({
          code: 'one-use-code',
          codeVerifier: 'pkce-verifier',
          expectedNonceDigest: digest('expected-nonce'),
        }),
      ).rejects.toThrow('Google identity could not be verified');
    },
  );
});

function config() {
  return {
    clientId: 'client-id.apps.googleusercontent.com',
    clientSecret: 'client-secret',
    redirectUri: 'https://studytube.page/api/auth/google/callback',
    attemptEncryptionKey: Buffer.alloc(32, 7),
    attemptTtlMs: 600_000 as const,
  };
}

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function oauthPort(payload: Record<string, unknown>): GoogleOAuthClientPort {
  return {
    generateAuthUrl(options) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        url.searchParams.set(
          key,
          Array.isArray(value) ? value.join(' ') : String(value),
        );
      }
      return url.toString();
    },
    getToken() {
      return Promise.resolve({
        tokens: {
          id_token: 'signed-id-token',
          access_token: 'discard-this-access-token',
          refresh_token: 'discard-this-refresh-token',
          token_type: 'Bearer',
          expiry_date: 1_788_003_600_000,
        },
      });
    },
    verifyIdToken() {
      return Promise.resolve({
        getPayload: () => payload,
      });
    },
  };
}
