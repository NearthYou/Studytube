import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_STORAGE_KEY } from '../src/localStudyStorage.ts';
import {
  normalizePreferences,
  normalizeSession,
  readSession,
  saveSession,
} from '../src/authSession.ts';
import type { Session } from '../src/types.ts';

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(seed));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function session(input: Partial<Session['user']> = {}): Session {
  return {
    token: 'token',
    user: {
      id: 1,
      name: 'Learner',
      email: 'learner@example.com',
      preferences: {
        interests: ['React'],
        pace: '20 minutes',
        goal: 'Practice daily',
      },
      createdAt: '2026-06-13T00:00:00.000Z',
      ...input,
    },
  };
}

test('normalizes missing learning preferences on sessions', () => {
  const normalized = normalizeSession(
    session({ preferences: { interests: [], pace: '', goal: '' } }),
  );

  assert.deepEqual(normalized.user.preferences, {
    interests: ['YouTube 학습', '프론트엔드'],
    pace: '하루 20분',
    goal: '짧은 영상으로 꾸준히 복습하기',
  });
});

test('reads and writes normalized sessions through an injectable storage adapter', () => {
  const storage = createMemoryStorage();

  saveSession(session({ preferences: undefined as never }), storage);

  assert.deepEqual(readSession(storage)?.user.preferences, {
    interests: ['YouTube 학습', '프론트엔드'],
    pace: '하루 20분',
    goal: '짧은 영상으로 꾸준히 복습하기',
  });
});

test('returns null when stored session JSON is invalid', () => {
  const storage = createMemoryStorage({ [SESSION_STORAGE_KEY]: '{broken' });

  assert.equal(readSession(storage), null);
});

test('normalizes partial preferences without discarding valid values', () => {
  assert.deepEqual(
    normalizePreferences({
      interests: [' React ', '', 'AI'],
      pace: ' 30 minutes ',
      goal: ' Build ',
    }),
    {
      interests: [' React ', 'AI'],
      pace: '30 minutes',
      goal: 'Build',
    },
  );
});
