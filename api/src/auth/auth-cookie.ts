import {
  ENROLLMENT_COOKIE_MAX_AGE_MS,
  OPAQUE_TOKEN_BASE64URL_CHARACTERS,
  OPAQUE_TOKEN_BYTES,
  SESSION_COOKIE_MAX_AGE_MS,
} from './auth.constants';

export type AuthCookieMode = 'production' | 'development';

export interface CookieResponse {
  cookie(
    name: string,
    value: string,
    options: Record<string, unknown>,
  ): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

const TOKEN_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${OPAQUE_TOKEN_BASE64URL_CHARACTERS}}$`,
  'u',
);

export class AuthCookiePolicy {
  readonly sessionCookieName: string;
  readonly enrollmentCookieName: string;
  private readonly secure: boolean;

  constructor(mode: AuthCookieMode) {
    this.secure = mode === 'production';
    const prefix = this.secure ? '__Host-' : '';
    this.sessionCookieName = `${prefix}studytube_session`;
    this.enrollmentCookieName = `${prefix}studytube_enrollment`;
  }

  setSessionCookie(response: CookieResponse, cookieValue: string): void {
    assertOpaqueToken(cookieValue);
    response.cookie(
      this.sessionCookieName,
      cookieValue,
      this.cookieOptions(SESSION_COOKIE_MAX_AGE_MS),
    );
  }

  setEnrollmentCookie(response: CookieResponse, cookieValue: string): void {
    assertOpaqueToken(cookieValue);
    response.cookie(
      this.enrollmentCookieName,
      cookieValue,
      this.cookieOptions(ENROLLMENT_COOKIE_MAX_AGE_MS),
    );
  }

  clearSessionCookie(response: CookieResponse): void {
    response.clearCookie(this.sessionCookieName, this.cookieOptions());
  }

  clearEnrollmentCookie(response: CookieResponse): void {
    response.clearCookie(this.enrollmentCookieName, this.cookieOptions());
  }

  readSessionCookie(cookieHeader: string | undefined): string | undefined {
    return readOpaqueTokenCookie(cookieHeader, this.sessionCookieName);
  }

  readEnrollmentCookie(cookieHeader: string | undefined): string | undefined {
    return readOpaqueTokenCookie(cookieHeader, this.enrollmentCookieName);
  }

  private cookieOptions(maxAge?: number): Record<string, unknown> {
    const options: Record<string, unknown> = {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
    };
    if (maxAge !== undefined) {
      options.maxAge = maxAge;
    }
    return options;
  }
}

export function readExactCookie(
  cookieHeader: string | undefined,
  exactName: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const matches: string[] = [];
  for (const rawPair of cookieHeader.split(';')) {
    const pair = rawPair.replace(/^[ \t]*/u, '');
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator) !== exactName) {
      continue;
    }
    matches.push(pair.slice(separator + 1));
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function readOpaqueTokenCookie(
  cookieHeader: string | undefined,
  exactName: string,
): string | undefined {
  const value = readExactCookie(cookieHeader, exactName);
  return value && isOpaqueToken(value) ? value : undefined;
}

function assertOpaqueToken(cookieValue: string): void {
  if (!isOpaqueToken(cookieValue)) {
    throw new RangeError('Invalid opaque cookie token');
  }
}

function isOpaqueToken(value: string): boolean {
  if (!TOKEN_PATTERN.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64url');
  return (
    decoded.length === OPAQUE_TOKEN_BYTES &&
    decoded.toString('base64url') === value
  );
}
