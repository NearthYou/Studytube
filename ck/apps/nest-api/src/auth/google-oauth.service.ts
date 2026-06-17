import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_WEB_APP_ORIGIN = 'http://localhost:5173';

type GoogleOAuthStatePayload = {
  redirectTo: string;
  exp: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfoResponse = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export type GoogleOAuthProfile = {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

@Injectable()
export class GoogleOAuthService {
  constructor(private readonly configService: ConfigService) {}

  createAuthorizationUrl(redirectTo?: string) {
    const clientId = this.getRequiredConfig('GOOGLE_OAUTH_CLIENT_ID');
    const redirectUri = this.getRequiredConfig('GOOGLE_OAUTH_REDIRECT_URI');
    const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);

    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('prompt', 'select_account');
    authorizationUrl.searchParams.set('state', this.createState(redirectTo));

    return authorizationUrl.toString();
  }

  verifyState(state: string | undefined) {
    if (!state) {
      throw new BadRequestException('Invalid Google OAuth state');
    }

    const [encodedPayload, signature] = state.split('.');
    if (
      !encodedPayload ||
      !signature ||
      !this.signatureMatches(encodedPayload, signature)
    ) {
      throw new BadRequestException('Invalid Google OAuth state');
    }

    const payload = this.parseStatePayload(encodedPayload);
    if (payload.exp <= Date.now()) {
      throw new BadRequestException('Google OAuth state expired');
    }

    return {
      redirectTo: this.getSafeRedirectPath(payload.redirectTo),
    };
  }

  async exchangeCodeForProfile(
    code: string | undefined,
  ): Promise<GoogleOAuthProfile> {
    if (!code?.trim()) {
      throw new BadRequestException('Google authorization code is required');
    }

    const accessToken = await this.exchangeCodeForAccessToken(code.trim());
    const profile = await this.fetchGoogleProfile(accessToken);

    if (!profile.email) {
      throw new UnauthorizedException('Google account did not return an email');
    }

    return {
      email: profile.email,
      emailVerified: profile.email_verified === true,
      name: profile.name,
      picture: profile.picture,
    };
  }

  createFrontendRedirectUrl(redirectTo: string) {
    const origin =
      this.getStringConfig('WEB_APP_ORIGIN') ??
      this.getStringConfig('FRONTEND_ORIGIN') ??
      DEFAULT_WEB_APP_ORIGIN;

    return new URL(this.getSafeRedirectPath(redirectTo), origin).toString();
  }

  createFrontendOAuthErrorUrl() {
    const url = new URL('/auth', this.createFrontendRedirectUrl('/'));
    url.searchParams.set('oauthError', 'google');

    return url.toString();
  }

  private async exchangeCodeForAccessToken(code: string) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.getRequiredConfig('GOOGLE_OAUTH_CLIENT_ID'),
        client_secret: this.getRequiredConfig('GOOGLE_OAUTH_CLIENT_SECRET'),
        redirect_uri: this.getRequiredConfig('GOOGLE_OAUTH_REDIRECT_URI'),
        grant_type: 'authorization_code',
      }),
    });
    const body = (await response
      .json()
      .catch(() => null)) as GoogleTokenResponse | null;

    if (!response.ok || !body?.access_token) {
      throw new UnauthorizedException(
        body?.error_description ??
          body?.error ??
          'Google OAuth token exchange failed',
      );
    }

    return body.access_token;
  }

  private async fetchGoogleProfile(accessToken: string) {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = (await response
      .json()
      .catch(() => null)) as GoogleUserInfoResponse | null;

    if (!response.ok || !body) {
      throw new UnauthorizedException('Failed to fetch Google profile');
    }

    return body;
  }

  private createState(redirectTo?: string) {
    const payload: GoogleOAuthStatePayload = {
      redirectTo: this.getSafeRedirectPath(redirectTo),
      exp: Date.now() + STATE_TTL_MS,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );

    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  private parseStatePayload(encodedPayload: string): GoogleOAuthStatePayload {
    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<GoogleOAuthStatePayload>;

      if (
        typeof parsed.redirectTo !== 'string' ||
        typeof parsed.exp !== 'number'
      ) {
        throw new Error('Invalid payload');
      }

      return {
        redirectTo: parsed.redirectTo,
        exp: parsed.exp,
      };
    } catch {
      throw new BadRequestException('Invalid Google OAuth state');
    }
  }

  private signatureMatches(encodedPayload: string, signature: string) {
    const expected = Buffer.from(this.sign(encodedPayload));
    const received = Buffer.from(signature);

    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private sign(value: string) {
    return createHmac('sha256', this.getStateSecret())
      .update(value)
      .digest('base64url');
  }

  private getSafeRedirectPath(redirectTo?: string) {
    if (
      !redirectTo ||
      !redirectTo.startsWith('/') ||
      redirectTo.startsWith('//')
    ) {
      return '/';
    }

    return redirectTo;
  }

  private getRequiredConfig(key: string) {
    const value = this.getStringConfig(key);
    if (!value) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }

    return value;
  }

  private getStateSecret() {
    return (
      this.getStringConfig('GOOGLE_OAUTH_STATE_SECRET') ??
      this.getStringConfig('JWT_SECRET') ??
      this.getRequiredConfig('GOOGLE_OAUTH_CLIENT_SECRET')
    );
  }

  private getStringConfig(key: string) {
    return this.configService.get<string>(key) ?? process.env[key];
  }
}
