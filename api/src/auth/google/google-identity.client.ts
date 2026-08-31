import { createHash, timingSafeEqual } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { GoogleAuthConfig } from './google-auth.config';

type GoogleClaims = Readonly<{
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
  nonce?: unknown;
}>;

export type GoogleIdentity = Readonly<{
  subject: string;
  email: string;
  emailVerified: true;
  name: string;
  pictureUrl: string | null;
}>;

export type GoogleAuthorizationInput = Readonly<{
  state: string;
  nonce: string;
  codeChallenge: string;
  prompt?: 'select_account';
}>;

export type GoogleCodeExchangeInput = Readonly<{
  code: string;
  codeVerifier: string;
  expectedNonceDigest: Buffer;
}>;

export interface GoogleIdentityClient {
  authorizationUrl(input: GoogleAuthorizationInput): string;
  exchange(input: GoogleCodeExchangeInput): Promise<GoogleIdentity>;
}

export interface GoogleOAuthClientPort {
  generateAuthUrl(
    options: Record<string, string | string[] | undefined>,
  ): string;
  getToken(options: {
    code: string;
    codeVerifier: string;
    redirect_uri: string;
  }): Promise<{
    tokens: Readonly<{
      id_token?: string | null;
      access_token?: string | null;
      refresh_token?: string | null;
      token_type?: string | null;
      expiry_date?: number | null;
    }>;
  }>;
  verifyIdToken(options: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): GoogleClaims | undefined }>;
}

export class OfficialGoogleIdentityClient implements GoogleIdentityClient {
  private readonly oauth: GoogleOAuthClientPort;

  constructor(
    private readonly config: GoogleAuthConfig,
    oauth?: GoogleOAuthClientPort,
  ) {
    this.oauth = oauth ?? oauthClientPort(config);
  }

  authorizationUrl(input: GoogleAuthorizationInput): string {
    return this.oauth.generateAuthUrl({
      response_type: 'code',
      scope: ['openid', 'email', 'profile'],
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: input.prompt,
    });
  }

  async exchange(input: GoogleCodeExchangeInput): Promise<GoogleIdentity> {
    try {
      const token = await this.oauth.getToken({
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirect_uri: this.config.redirectUri,
      });
      const idToken = token.tokens.id_token;
      if (!idToken) throw new Error('missing id token');
      const ticket = await this.oauth.verifyIdToken({
        idToken,
        audience: this.config.clientId,
      });
      return verifiedIdentity(ticket.getPayload(), input.expectedNonceDigest);
    } catch {
      throw new Error('Google identity could not be verified');
    }
  }
}

function oauthClientPort(config: GoogleAuthConfig): GoogleOAuthClientPort {
  const client = new OAuth2Client(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
  return {
    generateAuthUrl: (options) => client.generateAuthUrl(options),
    getToken: async (options) => {
      const response = await client.getToken(options);
      return { tokens: response.tokens };
    },
    verifyIdToken: async (options) => client.verifyIdToken(options),
  };
}

function verifiedIdentity(
  payload: GoogleClaims | undefined,
  expectedNonceDigest: Buffer,
): GoogleIdentity {
  const subject = normalizedClaim(payload?.sub);
  const email = normalizedClaim(payload?.email);
  const nonce = normalizedClaim(payload?.nonce);
  if (
    !subject ||
    !email ||
    payload?.email_verified !== true ||
    expectedNonceDigest.length !== 32 ||
    !nonce
  ) {
    throw new Error('invalid identity');
  }
  if (!nonceMatches(nonce, expectedNonceDigest)) {
    throw new Error('invalid nonce');
  }
  return Object.freeze({
    subject,
    email,
    emailVerified: true,
    name: normalizedClaim(payload?.name) ?? '학습자',
    pictureUrl: normalizedClaim(payload?.picture),
  });
}

function normalizedClaim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || /\p{Cc}/u.test(normalized)) return null;
  return normalized;
}

function nonceMatches(nonce: string, expectedDigest: Buffer): boolean {
  const actual = createHash('sha256').update(nonce, 'utf8').digest();
  return timingSafeEqual(actual, expectedDigest);
}
