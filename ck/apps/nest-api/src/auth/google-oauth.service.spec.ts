import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleOAuthService } from './google-oauth.service';

describe('GoogleOAuthService', () => {
  function createService(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      GOOGLE_OAUTH_STATE_SECRET: 'state-secret',
      WEB_APP_ORIGIN: 'http://localhost:5173',
      ...overrides,
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    return new GoogleOAuthService(configService);
  }

  it('creates a Google authorization URL with a signed local redirect state', () => {
    const service = createService();

    const authorizationUrl = service.createAuthorizationUrl('/theaters/50');
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state');

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/google/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('scope')).toContain('profile');
    expect(state).toEqual(expect.any(String));
    expect(service.verifyState(state ?? undefined)).toEqual({
      redirectTo: '/theaters/50',
    });
  });

  it('normalizes unsafe redirect targets before signing state', () => {
    const service = createService();
    const authorizationUrl = service.createAuthorizationUrl(
      'https://evil.example',
    );
    const state = new URL(authorizationUrl).searchParams.get('state');

    expect(service.verifyState(state ?? undefined)).toEqual({
      redirectTo: '/',
    });
  });

  it('rejects a tampered OAuth state', () => {
    const service = createService();
    const authorizationUrl = service.createAuthorizationUrl('/reviews');
    const state = new URL(authorizationUrl).searchParams.get('state') ?? '';

    expect(() => service.verifyState(`${state}x`)).toThrow(BadRequestException);
  });

  it('fails clearly when Google OAuth credentials are missing', () => {
    const service = createService({
      GOOGLE_OAUTH_CLIENT_ID: undefined,
    });

    expect(() => service.createAuthorizationUrl('/')).toThrow(
      ServiceUnavailableException,
    );
  });
});
