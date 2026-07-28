import {
  ENROLLMENT_COOKIE_MAX_AGE_MS,
  OPAQUE_TOKEN_BASE64URL_CHARACTERS,
  SESSION_COOKIE_MAX_AGE_MS,
} from './auth.constants';

export type AuthCookieMode = 'production' | 'development';

export interface CookieResponse {
  cookie(
    name: string,
    value: string,
    options: Record<string, unknown>,
  ): unknown;
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

  readSessionCookie(cookieHeader: string | undefined): string | undefined {
    return readOpaqueTokenCookie(cookieHeader, this.sessionCookieName);
  }

  readEnrollmentCookie(cookieHeader: string | undefined): string | undefined {
    return readOpaqueTokenCookie(cookieHeader, this.enrollmentCookieName);
  }

  private cookieOptions(maxAge: number): Record<string, unknown> {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      maxAge,
    };
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
    const pair = rawPair.trimStart();
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== exactName) {
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
  if (!value || !TOKEN_PATTERN.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? value : undefined;
}

function assertOpaqueToken(cookieValue: string): void {
  if (!TOKEN_PATTERN.test(cookieValue)) {
    throw new RangeError('Invalid opaque cookie token');
  }
}
