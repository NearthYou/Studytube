export const SESSION_STORAGE_KEY = 'studytube.session';

export function scopedStudyStorageKey(baseKey: string, sessionValue: string | null) {
  return `${baseKey}:${studyStorageScopeFromSessionValue(sessionValue)}`;
}

export function scopedStudyStorageKeyFromStorage(
  baseKey: string,
  storage: Pick<Storage, 'getItem'>,
) {
  return scopedStudyStorageKey(baseKey, storage.getItem(SESSION_STORAGE_KEY));
}

export function studyStorageScopeFromSessionValue(sessionValue: string | null) {
  if (!sessionValue) {
    return 'anonymous';
  }

  try {
    const session = JSON.parse(sessionValue) as {
      user?: { id?: unknown; email?: unknown };
    };
    const userId = session.user?.id;
    const email = session.user?.email;

    if (typeof userId === 'number' || typeof userId === 'string') {
      return `user-${String(userId).trim()}`;
    }

    if (typeof email === 'string' && email.trim()) {
      return `email-${sanitizeStorageScope(email)}`;
    }
  } catch {
    return 'anonymous';
  }

  return 'anonymous';
}

function sanitizeStorageScope(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
