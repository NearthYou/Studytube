export type AuthMode = 'login' | 'signup';

const DEFAULT_LOGIN_DESTINATION = '/';
const DEFAULT_SIGNUP_NEXT_DESTINATION = '/board';
const TUTORIAL_DESTINATION = '/tutorial';
const AUTH_DESTINATIONS = new Set(['/login', '/signup', '/tutorial']);

export function authCompletionDestination({
  mode,
  from,
}: {
  mode: AuthMode;
  from: string;
}) {
  if (mode === 'signup') {
    return TUTORIAL_DESTINATION;
  }

  return normalizeInternalPath(from, DEFAULT_LOGIN_DESTINATION);
}

export function signupTutorialNextDestination(from: string) {
  const normalizedPath = normalizeInternalPath(
    from,
    DEFAULT_SIGNUP_NEXT_DESTINATION,
  );

  if (normalizedPath === '/' || AUTH_DESTINATIONS.has(normalizedPath)) {
    return DEFAULT_SIGNUP_NEXT_DESTINATION;
  }

  return normalizedPath;
}

export function tutorialNextDestination(value: unknown) {
  if (typeof value !== 'string') {
    return DEFAULT_SIGNUP_NEXT_DESTINATION;
  }

  const normalizedPath = normalizeInternalPath(
    value,
    DEFAULT_SIGNUP_NEXT_DESTINATION,
  );

  if (normalizedPath === '/' || AUTH_DESTINATIONS.has(normalizedPath)) {
    return DEFAULT_SIGNUP_NEXT_DESTINATION;
  }

  return normalizedPath;
}

function normalizeInternalPath(path: string, fallback: string) {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return fallback;
  }

  return path;
}
