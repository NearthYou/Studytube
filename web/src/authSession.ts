import { SESSION_STORAGE_KEY } from './localStudyStorage.ts';
import type { LearningPreferences, Session, User } from './types.ts';

export function readSession(storage: Storage = window.localStorage): Session | null {
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    return raw ? normalizeSession(JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(
  session: Session,
  storage: Storage = window.localStorage,
) {
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalizeSession(session)));
}

export function normalizeSession(session: Session): Session {
  return {
    user: normalizeUser(session.user),
  };
}

export function normalizeUser(user: User): User {
  return {
    ...user,
    preferences: normalizePreferences(user.preferences),
  };
}

export function normalizePreferences(
  preferences: Partial<LearningPreferences> | undefined,
): LearningPreferences {
  const interests = Array.isArray(preferences?.interests)
    ? preferences.interests.filter((item): item is string => Boolean(item?.trim()))
    : [];

  return {
    interests,
    pace: preferences?.pace?.trim() || '',
    goal: preferences?.goal?.trim() || '',
  };
}
