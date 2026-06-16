import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scopedStudyStorageKey,
  studyStorageScopeFromSessionValue,
} from '../src/localStudyStorage.ts';

test('uses a distinct local storage scope for each signed-in user', () => {
  const firstSession = JSON.stringify({
    user: { id: 1, email: 'first@example.com' },
  });
  const secondSession = JSON.stringify({
    user: { id: 2, email: 'second@example.com' },
  });

  assert.equal(
    scopedStudyStorageKey('studytube.watchQueue', firstSession),
    'studytube.watchQueue:user-1',
  );
  assert.equal(
    scopedStudyStorageKey('studytube.watchQueue', secondSession),
    'studytube.watchQueue:user-2',
  );
});

test('falls back to a safe anonymous scope when no session is available', () => {
  assert.equal(studyStorageScopeFromSessionValue(null), 'anonymous');
  assert.equal(studyStorageScopeFromSessionValue('{bad json'), 'anonymous');
});
