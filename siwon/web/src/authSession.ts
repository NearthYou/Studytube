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
    ...session,
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
    interests: interests.length > 0 ? interests : ['YouTube 학습', '프론트엔드'],
    pace: preferences?.pace?.trim() || '하루 20분',
    goal: preferences?.goal?.trim() || '짧은 영상으로 꾸준히 복습하기',
  };
}
