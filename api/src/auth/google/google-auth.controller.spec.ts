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
    fixture.completeLogin.mockResolvedValueOnce({
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
    expect(cancelled.completeLogin).not.toHaveBeenCalled();

    const expired = createFixture();
    expired.completeLogin.mockResolvedValueOnce({ status: 'invalid' });
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
    fixture.completeLogin.mockRejectedValueOnce(
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
});

function createFixture() {
  const startLogin = jest.fn(() =>
    Promise.resolve({
      authorizationUrl:
        'https://accounts.google.com/o/oauth2/v2/auth?state=opaque',
    }),
  );
  const completeLogin = jest.fn();
  const service = {
    startLogin,
    completeLogin,
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
    completeLogin,
    setSessionCookie,
    redirect,
    response,
  };
}
