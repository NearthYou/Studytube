import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  buildRefreshCookieValue,
  extractAccessTokenFromRequest,
  extractCookieValue,
  parseRefreshCookieValue,
} from './auth-cookie.utils';

describe('auth cookie utilities', () => {
  describe('extractCookieValue', () => {
    it('extracts a named cookie from a request-like object', () => {
      const request = {
        headers: {
          cookie: `theme=dark; ${ACCESS_TOKEN_COOKIE}=access.jwt.value; ${REFRESH_TOKEN_COOKIE}=refresh.value`,
        },
      };

      expect(extractCookieValue(request, ACCESS_TOKEN_COOKIE)).toBe(
        'access.jwt.value',
      );
    });

    it('decodes url-encoded cookie values', () => {
      const request = {
        headers: {
          cookie: `${ACCESS_TOKEN_COOKIE}=hello%20world`,
        },
      };

      expect(extractCookieValue(request, ACCESS_TOKEN_COOKIE)).toBe(
        'hello world',
      );
    });

    it('returns undefined when the cookie is missing', () => {
      expect(extractCookieValue({ headers: { cookie: 'a=1' } }, 'missing')).toBe(
        undefined,
      );
    });
  });

  describe('extractAccessTokenFromRequest', () => {
    it('prefers a bearer token when both bearer and cookie tokens exist', () => {
      const request = {
        headers: {
          authorization: 'Bearer header.jwt',
          cookie: `${ACCESS_TOKEN_COOKIE}=cookie.jwt`,
        },
      };

      expect(extractAccessTokenFromRequest(request)).toBe('header.jwt');
    });

    it('falls back to the httpOnly access-token cookie', () => {
      const request = {
        headers: {
          cookie: `${ACCESS_TOKEN_COOKIE}=cookie.jwt`,
        },
      };

      expect(extractAccessTokenFromRequest(request)).toBe('cookie.jwt');
    });
  });

  describe('refresh cookie value format', () => {
    it('round-trips the session id and secret', () => {
      const value = buildRefreshCookieValue('session-123', 'secret-456');

      expect(parseRefreshCookieValue(value)).toEqual({
        sessionId: 'session-123',
        secret: 'secret-456',
      });
    });

    it('rejects malformed refresh cookie values', () => {
      expect(parseRefreshCookieValue('missing-secret')).toBeNull();
      expect(parseRefreshCookieValue('.secret')).toBeNull();
      expect(parseRefreshCookieValue('session.')).toBeNull();
      expect(parseRefreshCookieValue('too.many.parts')).toBeNull();
    });
  });
});
