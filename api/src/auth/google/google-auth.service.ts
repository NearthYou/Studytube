import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_IDLE_MAX_AGE_MS,
} from '../auth.constants';
import { issueOpaqueToken, type OpaqueTokenIssue } from '../auth-token';
import type { AuthPublicUser } from '../auth.types';
import type { GoogleAttemptCrypto } from './google-attempt.crypto';
import type { GoogleAuthRepository } from './google-auth.repository';
import type { GoogleIdentityClient } from './google-identity.client';

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const SAFE_RETURN_ORIGIN = 'https://studytube.local';
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type GoogleAuthServiceOptions = {
  repository: GoogleAuthRepository;
  identityClient: GoogleIdentityClient;
  attemptCrypto: GoogleAttemptCrypto;
  clock: () => Date;
  uuid?: () => string;
  randomBytes?: (size: number) => Buffer;
  opaqueTokenFactory?: () => OpaqueTokenIssue;
  attemptTtlMs?: number;
};

export type CompleteGoogleLoginResult =
  | {
      status: 'authenticated';
      sessionToken: string;
      user: AuthPublicUser;
      newUser: boolean;
      returnPath: string;
    }
  | { status: 'invalid' };

export class GoogleAuthService {
  private readonly uuid: () => string;
  private readonly random: (size: number) => Buffer;
  private readonly opaqueTokenFactory: () => OpaqueTokenIssue;
  private readonly attemptTtlMs: number;

  constructor(private readonly options: GoogleAuthServiceOptions) {
    this.uuid = options.uuid ?? randomUUID;
    this.random = options.randomBytes ?? randomBytes;
    this.opaqueTokenFactory = options.opaqueTokenFactory ?? issueOpaqueToken;
    this.attemptTtlMs = options.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS;
    if (!Number.isSafeInteger(this.attemptTtlMs) || this.attemptTtlMs <= 0) {
      throw new RangeError(
        'Google authentication attempt TTL must be positive',
      );
    }
  }

  async startLogin(input: { returnPath?: string } = {}) {
    const state = this.random(32).toString('base64url');
    const nonce = this.random(32).toString('base64url');
    const verifier = this.random(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(verifier, 'utf8')
      .digest('base64url');
    const createdAt = this.options.clock();
    const returnPath = safeReturnPath(input.returnPath);

    await this.options.repository.createGoogleAuthAttempt({
      id: this.uuid(),
      purpose: 'login',
      stateDigest: this.options.attemptCrypto.digest(state),
      nonceDigest: this.options.attemptCrypto.digest(nonce),
      encryptedCodeVerifier:
        this.options.attemptCrypto.encryptVerifier(verifier),
      returnPath,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.attemptTtlMs),
    });

    return Object.freeze({
      authorizationUrl: this.options.identityClient.authorizationUrl({
        state,
        nonce,
        codeChallenge,
      }),
    });
  }

  async completeLogin(input: {
    state: string;
    code: string;
  }): Promise<CompleteGoogleLoginResult> {
    if (!STATE_PATTERN.test(input.state) || !input.code.trim()) {
      return { status: 'invalid' };
    }
    const consumedAt = this.options.clock();
    const consumed = await this.options.repository.consumeGoogleAuthAttempt(
      this.options.attemptCrypto.digest(input.state),
      consumedAt,
    );
    if (
      consumed.status !== 'consumed' ||
      consumed.attempt.purpose !== 'login'
    ) {
      return { status: 'invalid' };
    }

    let verifier: string;
    try {
      verifier = this.options.attemptCrypto.decryptVerifier(
        consumed.attempt.encryptedCodeVerifier,
      );
    } catch {
      return { status: 'invalid' };
    }
    const identity = await this.options.identityClient.exchange({
      code: input.code,
      codeVerifier: verifier,
      expectedNonceDigest: consumed.attempt.nonceDigest,
    });
    const session = this.opaqueTokenFactory();
    const sessionId = this.uuid();
    const committed = await this.options.repository.commitGoogleLogin({
      googleSubject: identity.subject,
      email: identity.email,
      emailCanonical: identity.email.trim().toLowerCase(),
      name: normalizedName(identity.name),
      profileImageUrl: identity.pictureUrl,
      authenticatedAt: consumedAt,
      sessionId,
      sessionDigest: session.persistence.digest,
      sessionCreatedAt: consumedAt,
      sessionAbsoluteExpiresAt: new Date(
        consumedAt.getTime() + SESSION_COOKIE_MAX_AGE_MS,
      ),
      sessionIdleExpiresAt: new Date(
        consumedAt.getTime() + SESSION_IDLE_MAX_AGE_MS,
      ),
    });
    if (committed.status !== 'committed') return { status: 'invalid' };

    return Object.freeze({
      status: 'authenticated',
      sessionToken: session.cookieValue,
      user: committed.user,
      newUser: committed.newUser,
      returnPath: consumed.attempt.returnPath,
    });
  }
}

export function safeReturnPath(value: string | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /\p{Cc}/u.test(value)
  ) {
    return '/';
  }
  try {
    const parsed = new URL(value, SAFE_RETURN_ORIGIN);
    if (
      parsed.origin !== SAFE_RETURN_ORIGIN ||
      parsed.pathname === '/auth' ||
      parsed.pathname.startsWith('/auth/')
    ) {
      return '/';
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function normalizedName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || /\p{Cc}/u.test(normalized)) {
    return '학습자';
  }
  return normalized;
}
