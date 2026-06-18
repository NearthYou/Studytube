export const ACCESS_TOKEN_COOKIE = 'jungle_access_token';
export const REFRESH_TOKEN_COOKIE = 'jungle_refresh_token';

type RequestLike = {
  headers?: {
    authorization?: string | string[];
    cookie?: string | string[];
  };
};

export type ParsedRefreshCookie = {
  sessionId: string;
  secret: string;
};

export function extractCookieValue(
  request: RequestLike | undefined,
  cookieName: string,
) {
  const cookieHeader = request?.headers?.cookie;
  const cookieString = Array.isArray(cookieHeader)
    ? cookieHeader.join('; ')
    : cookieHeader;

  if (!cookieString) {
    return undefined;
  }

  const cookies = cookieString.split(';');
  for (const cookie of cookies) {
    const [rawName, ...rawValueParts] = cookie.trim().split('=');
    if (rawName !== cookieName) {
      continue;
    }

    const rawValue = rawValueParts.join('=');
    return decodeURIComponent(rawValue);
  }

  return undefined;
}

export function extractAccessTokenFromRequest(
  request: RequestLike | undefined,
) {
  const authorizationHeader = request?.headers?.authorization;
  const authorization = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);

  if (bearerMatch?.[1]) {
    return bearerMatch[1];
  }

  return extractCookieValue(request, ACCESS_TOKEN_COOKIE) ?? null;
}

export function buildRefreshCookieValue(sessionId: string, secret: string) {
  return `${sessionId}.${secret}`;
}

export function parseRefreshCookieValue(
  value: string | undefined,
): ParsedRefreshCookie | null {
  if (!value) {
    return null;
  }

  const parts = value.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [sessionId, secret] = parts;
  if (!sessionId || !secret) {
    return null;
  }

  return { sessionId, secret };
}
