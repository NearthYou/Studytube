import {
  AuthCookiePolicy,
  readExactCookie,
  type CookieResponse,
} from './auth-cookie';

describe('AuthCookiePolicy', () => {
  const token = Buffer.alloc(32, 0x6a).toString('base64url');

  it('sets the production session cookie with fixed __Host- attributes', () => {
    const response = new CapturingCookieResponse();
    const policy = new AuthCookiePolicy('production');

    policy.setSessionCookie(response, token);

    expect(response.cookies).toEqual([
      {
        name: '__Host-studytube_session',
        value: token,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      },
    ]);
    expect(response.cookies[0]?.options).not.toHaveProperty('domain');
  });

  it('uses a separate ten-minute production enrollment cookie', () => {
    const response = new CapturingCookieResponse();
    const policy = new AuthCookiePolicy('production');

    policy.setEnrollmentCookie(response, token);

    expect(response.cookies).toEqual([
      {
        name: '__Host-studytube_enrollment',
        value: token,
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 10 * 60 * 1000,
        },
      },
    ]);
  });

  it('uses distinct non-Host cookie names without Secure in development', () => {
    const response = new CapturingCookieResponse();
    const policy = new AuthCookiePolicy('development');

    policy.setSessionCookie(response, token);
    policy.setEnrollmentCookie(response, token);

    expect(response.cookies.map(({ name }) => name)).toEqual([
      'studytube_session',
      'studytube_enrollment',
    ]);
    expect(
      response.cookies.every(({ options }) => options.secure === false),
    ).toBe(true);
  });

  it('reads only one exact-name cookie with canonical token grammar', () => {
    const policy = new AuthCookiePolicy('production');

    expect(
      policy.readSessionCookie(
        `prefix__Host-studytube_session=${token}; __Host-studytube_session=${token}`,
      ),
    ).toBe(token);
    expect(
      policy.readSessionCookie(
        `__Host-studytube_session_extra=${token}; __Host-studytube_session=${token}`,
      ),
    ).toBe(token);
    expect(
      policy.readSessionCookie(`__Host-studytube_session=${token}=`),
    ).toBeUndefined();
    const nonCanonical = `${token.slice(0, -1)}B`;
    expect(
      policy.readSessionCookie(`__Host-studytube_session=${nonCanonical}`),
    ).toBeUndefined();
    expect(
      policy.readSessionCookie(
        `__Host-studytube_session=${token}; __Host-studytube_session=${token}`,
      ),
    ).toBeUndefined();
  });

  it('splits a cookie pair at the first equals and preserves the rest', () => {
    expect(readExactCookie('opaque=a=b=c ; other=value', 'opaque')).toBe(
      'a=b=c ',
    );
  });

  it('does not accept a Bearer credential as a cookie', () => {
    const policy = new AuthCookiePolicy('production');

    expect(policy.readSessionCookie(`Bearer ${token}`)).toBeUndefined();
  });
});

class CapturingCookieResponse implements CookieResponse {
  readonly cookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];

  cookie(name: string, value: string, options: Record<string, unknown>): this {
    this.cookies.push({ name, value, options });
    return this;
  }
}
