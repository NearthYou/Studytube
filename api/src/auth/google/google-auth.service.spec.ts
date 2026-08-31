import { createHash } from 'node:crypto';
import type { AuthPublicUser } from '../auth.types';
import type { OpaqueTokenIssue } from '../auth-token';
import { GoogleAttemptCrypto } from './google-attempt.crypto';
import {
  GoogleAuthService,
  type GoogleAuthServiceOptions,
} from './google-auth.service';
import type {
  CommitGoogleLoginCommand,
  CreateGoogleAuthAttemptCommand,
  GoogleAuthRepository,
  StoredGoogleAuthAttempt,
} from './google-auth.repository';
import type {
  GoogleAuthorizationInput,
  GoogleCodeExchangeInput,
  GoogleIdentityClient,
} from './google-identity.client';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const USER: AuthPublicUser = {
  id: 71,
  name: '학습자',
  email: 'learner@example.com',
  preferences: { interests: [], pace: '', goal: '' },
  createdAt: '2026-08-31T12:00:00.000Z',
};

describe('GoogleAuthService', () => {
  it('starts one login without persisting raw state, nonce or PKCE verifier', async () => {
    const fixture = createFixture();

    const started = await fixture.service.startLogin({
      returnPath: '/courses',
    });
    const url = new URL(started.authorizationUrl);
    const state = url.searchParams.get('state');
    const nonce = url.searchParams.get('nonce');
    const stored = fixture.repository.created[0];

    expect(state).toBe(Buffer.alloc(32, 0x11).toString('base64url'));
    expect(nonce).toBe(Buffer.alloc(32, 0x22).toString('base64url'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(stored).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      purpose: 'login',
      returnPath: '/courses',
      createdAt: NOW,
      expiresAt: new Date('2026-08-31T12:10:00.000Z'),
    });
    expect(stored?.stateDigest).toEqual(sha256(state ?? ''));
    expect(stored?.nonceDigest).toEqual(sha256(nonce ?? ''));
    expect(stored?.encryptedCodeVerifier.toString('utf8')).not.toContain(
      Buffer.alloc(64, 0x33).toString('base64url'),
    );
  });

  it('consumes the attempt once and creates a session by Google subject', async () => {
    const fixture = createFixture();
    const started = await fixture.service.startLogin({
      returnPath: '/courses',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('Expected state');

    const completed = await fixture.service.completeLogin({
      state,
      code: 'one-use-code',
    });

    expect(completed).toEqual({
      status: 'authenticated',
      sessionToken: 'opaque-session-cookie',
      user: USER,
      newUser: true,
      returnPath: '/courses',
    });
    expect(fixture.identity.exchanges).toEqual([
      {
        code: 'one-use-code',
        codeVerifier: Buffer.alloc(64, 0x33).toString('base64url'),
        expectedNonceDigest: sha256(
          Buffer.alloc(32, 0x22).toString('base64url'),
        ),
      },
    ]);
    expect(fixture.repository.committed[0]).toMatchObject({
      googleSubject: 'google-subject-1',
      email: 'learner@example.com',
      emailCanonical: 'learner@example.com',
      name: 'Learner',
      profileImageUrl: 'https://example.com/avatar.png',
      sessionId: '22222222-2222-4222-8222-222222222222',
    });

    await expect(
      fixture.service.completeLogin({ state, code: 'replayed-code' }),
    ).resolves.toEqual({ status: 'invalid' });
    expect(fixture.identity.exchanges).toHaveLength(1);
  });

  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/auth/google/callback',
    '/path\\to\\somewhere',
  ])(
    'replaces an unsafe return path with the learning home: %s',
    async (returnPath) => {
      const fixture = createFixture();

      await fixture.service.startLogin({ returnPath });

      expect(fixture.repository.created[0]?.returnPath).toBe('/');
    },
  );

  it('binds account-deletion reauthentication to the current user and session', async () => {
    const fixture = createFixture();

    const started = await fixture.service.startAccountDeletion({
      userId: 71,
      sessionId: '33333333-3333-4333-8333-333333333333',
    });
    const url = new URL(started.authorizationUrl);

    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(fixture.repository.created[0]).toMatchObject({
      purpose: 'delete_account',
      userId: 71,
      sessionId: '33333333-3333-4333-8333-333333333333',
      returnPath: '/me/delete',
    });
  });

  it('marks only the same Google identity as recently reauthenticated', async () => {
    const fixture = createFixture();
    const started = await fixture.service.startAccountDeletion({
      userId: 71,
      sessionId: '33333333-3333-4333-8333-333333333333',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('Expected state');

    await expect(
      fixture.service.completeAuthorization({ state, code: 'deletion-code' }),
    ).resolves.toEqual({ status: 'deletion_verified' });
    expect(fixture.repository.reauthenticated).toEqual([
      {
        userId: 71,
        sessionId: '33333333-3333-4333-8333-333333333333',
        googleSubject: 'google-subject-1',
        reauthenticatedAt: NOW,
      },
    ]);
  });

  it('does not authorize deletion when another Google account is selected', async () => {
    const fixture = createFixture();
    fixture.identity.subject = 'another-google-subject';
    fixture.repository.acceptReauthentication = false;
    const started = await fixture.service.startAccountDeletion({
      userId: 71,
      sessionId: '33333333-3333-4333-8333-333333333333',
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('Expected state');

    await expect(
      fixture.service.completeAuthorization({
        state,
        code: 'wrong-account-code',
      }),
    ).resolves.toEqual({ status: 'wrong_account' });
  });
});

function createFixture() {
  const repository = new MemoryGoogleAuthRepository();
  const identity = new MemoryGoogleIdentityClient();
  const randomValues = [
    Buffer.alloc(32, 0x11),
    Buffer.alloc(32, 0x22),
    Buffer.alloc(64, 0x33),
  ];
  const options: GoogleAuthServiceOptions = {
    repository,
    identityClient: identity,
    attemptCrypto: new GoogleAttemptCrypto(Buffer.alloc(32, 0x44), () =>
      Buffer.alloc(12, 0x55),
    ),
    clock: () => NOW,
    uuid: sequence(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ),
    randomBytes: () => {
      const value = randomValues.shift();
      if (!value) throw new Error('Unexpected random request');
      return value;
    },
    opaqueTokenFactory: () =>
      ({
        cookieValue: 'opaque-session-cookie',
        persistence: { digest: Buffer.alloc(32, 0x66) },
      }) satisfies OpaqueTokenIssue,
  };
  return {
    service: new GoogleAuthService(options),
    repository,
    identity,
  };
}

class MemoryGoogleAuthRepository implements GoogleAuthRepository {
  readonly created: CreateGoogleAuthAttemptCommand[] = [];
  readonly committed: CommitGoogleLoginCommand[] = [];
  readonly reauthenticated: Array<{
    userId: number;
    sessionId: string;
    googleSubject: string;
    reauthenticatedAt: Date;
  }> = [];
  acceptReauthentication = true;
  private readonly attempts = new Map<string, StoredGoogleAuthAttempt>();

  createGoogleAuthAttempt(command: CreateGoogleAuthAttemptCommand) {
    this.created.push(command);
    this.attempts.set(command.stateDigest.toString('hex'), {
      id: command.id,
      purpose: command.purpose,
      nonceDigest: command.nonceDigest,
      encryptedCodeVerifier: command.encryptedCodeVerifier,
      ...(command.userId === undefined ? {} : { userId: command.userId }),
      ...(command.sessionId === undefined
        ? {}
        : { sessionId: command.sessionId }),
      returnPath: command.returnPath,
    });
    return Promise.resolve();
  }

  consumeGoogleAuthAttempt(stateDigest: Buffer) {
    const key = stateDigest.toString('hex');
    const attempt = this.attempts.get(key);
    this.attempts.delete(key);
    return Promise.resolve(
      attempt
        ? ({ status: 'consumed', attempt } as const)
        : ({ status: 'invalid' } as const),
    );
  }

  commitGoogleLogin(command: CommitGoogleLoginCommand) {
    this.committed.push(command);
    return Promise.resolve({
      status: 'committed',
      user: USER,
      newUser: true,
    } as const);
  }

  markGoogleReauthenticated(command: {
    userId: number;
    sessionId: string;
    googleSubject: string;
    reauthenticatedAt: Date;
  }) {
    this.reauthenticated.push(command);
    return Promise.resolve(this.acceptReauthentication);
  }
}

class MemoryGoogleIdentityClient implements GoogleIdentityClient {
  readonly exchanges: GoogleCodeExchangeInput[] = [];
  subject = 'google-subject-1';

  authorizationUrl(input: GoogleAuthorizationInput) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (input.prompt) url.searchParams.set('prompt', input.prompt);
    return url.toString();
  }

  exchange(input: GoogleCodeExchangeInput) {
    this.exchanges.push(input);
    return Promise.resolve({
      subject: this.subject,
      email: 'learner@example.com',
      emailVerified: true as const,
      name: 'Learner',
      pictureUrl: 'https://example.com/avatar.png',
    });
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sequence(...values: string[]) {
  return () => {
    const value = values.shift();
    if (!value) throw new Error('Unexpected UUID request');
    return value;
  };
}
