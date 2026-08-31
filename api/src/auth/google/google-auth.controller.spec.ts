import type { Response } from 'express';
import type { AuthCookiePolicy } from '../auth-cookie';
import { GoogleAuthController } from './google-auth.controller';
import type { GoogleAuthService } from './google-auth.service';

describe('GoogleAuthController', () => {
  it('redirects a login start to the bounded Google authorization URL', async () => {
    const fixture = createFixture();

    await fixture.controller.start('/courses', fixture.response);

    expect(fixture.startLogin).toHaveBeenCalledWith({
      returnPath: '/courses',
    });
    expect(fixture.redirect).toHaveBeenCalledWith(
      302,
      'https://accounts.google.com/o/oauth2/v2/auth?state=opaque',
    );
  });

  it('sets the opaque session cookie before redirecting to Web completion', async () => {
    const fixture = createFixture();
    fixture.completeAuthorization.mockResolvedValueOnce({
      status: 'authenticated',
      sessionToken: 'opaque-session-cookie',
      user: {
        id: 7,
        name: 'Learner',
        email: 'learner@example.com',
        preferences: { interests: [], pace: '', goal: '' },
        createdAt: '2026-08-31T12:00:00.000Z',
      },
      newUser: true,
      returnPath: '/courses',
    });

    await fixture.controller.callback(
      'state-value',
      'code-value',
      undefined,
      fixture.response,
    );

    expect(fixture.setSessionCookie).toHaveBeenCalledWith(
      fixture.response,
      'opaque-session-cookie',
    );
    expect(fixture.redirect).toHaveBeenCalledWith(
      302,
      '/auth/google/complete?new=1&returnTo=%2Ftutorial',
    );
  });

  it('maps cancellation and invalid state to bounded Korean UI states', async () => {
    const cancelled = createFixture();
    await cancelled.controller.callback(
      undefined,
      undefined,
      'access_denied',
      cancelled.response,
    );
    expect(cancelled.redirect).toHaveBeenCalledWith(
      302,
      '/login?googleError=cancelled',
    );
    expect(cancelled.completeAuthorization).not.toHaveBeenCalled();

    const expired = createFixture();
    expired.completeAuthorization.mockResolvedValueOnce({ status: 'invalid' });
    await expired.controller.callback(
      'state-value',
      'code-value',
      undefined,
      expired.response,
    );
    expect(expired.redirect).toHaveBeenCalledWith(
      302,
      '/login?googleError=expired',
    );
    expect(expired.setSessionCookie).not.toHaveBeenCalled();
  });

  it('does not expose a provider failure in the redirect URL', async () => {
    const fixture = createFixture();
    fixture.completeAuthorization.mockRejectedValueOnce(
      new Error('upstream contained a private token'),
    );

    await fixture.controller.callback(
      'state-value',
      'code-value',
      undefined,
      fixture.response,
    );

    expect(fixture.redirect).toHaveBeenCalledWith(
      302,
      '/login?googleError=unavailable',
    );
    expect(JSON.stringify(fixture.redirect.mock.calls)).not.toContain(
      'private token',
    );
  });

  it('starts deletion reauthentication for the current session only', async () => {
    const fixture = createFixture();

    await fixture.controller.startDeletion(
      {
        principal: {
          userId: 71,
          sessionId: '33333333-3333-4333-8333-333333333333',
        },
      } as never,
      fixture.response,
    );

    expect(fixture.startAccountDeletion).toHaveBeenCalledWith({
      userId: 71,
      sessionId: '33333333-3333-4333-8333-333333333333',
    });
    expect(fixture.redirect).toHaveBeenCalledWith(
      302,
      'https://accounts.google.com/o/oauth2/v2/auth?state=deletion',
    );
  });

  it('returns deletion callbacks to the confirmation page without a new session', async () => {
    const verified = createFixture();
    verified.completeAuthorization.mockResolvedValueOnce({
      status: 'deletion_verified',
    });
    await verified.controller.callback(
      'state-value',
      'code-value',
      undefined,
      verified.response,
    );
    expect(verified.redirect).toHaveBeenCalledWith(
      302,
      '/me/delete?verified=1',
    );
    expect(verified.setSessionCookie).not.toHaveBeenCalled();

    const wrongAccount = createFixture();
    wrongAccount.completeAuthorization.mockResolvedValueOnce({
      status: 'wrong_account',
    });
    await wrongAccount.controller.callback(
      'state-value',
      'code-value',
      undefined,
      wrongAccount.response,
    );
    expect(wrongAccount.redirect).toHaveBeenCalledWith(
      302,
      '/me/delete?googleError=wrong_account',
    );
  });
});

function createFixture() {
  const startLogin = jest.fn(() =>
    Promise.resolve({
      authorizationUrl:
        'https://accounts.google.com/o/oauth2/v2/auth?state=opaque',
    }),
  );
  const completeAuthorization = jest.fn();
  const startAccountDeletion = jest.fn(() =>
    Promise.resolve({
      authorizationUrl:
        'https://accounts.google.com/o/oauth2/v2/auth?state=deletion',
    }),
  );
  const service = {
    startLogin,
    completeAuthorization,
    startAccountDeletion,
  } as unknown as jest.Mocked<GoogleAuthService>;
  const setSessionCookie = jest.fn();
  const cookies = {
    setSessionCookie,
  } as unknown as jest.Mocked<AuthCookiePolicy>;
  const redirect = jest.fn();
  const response = {
    redirect,
  } as unknown as jest.Mocked<Response>;
  return {
    controller: new GoogleAuthController(service, cookies),
    startLogin,
    completeAuthorization,
    startAccountDeletion,
    setSessionCookie,
    redirect,
    response,
  };
}
