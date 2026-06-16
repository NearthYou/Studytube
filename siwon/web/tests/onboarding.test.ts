import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authCompletionDestination,
  signupTutorialNextDestination,
  tutorialNextDestination,
} from '../src/onboarding.ts';

test('routes first signups into the tutorial before the app workspace', () => {
  assert.equal(
    authCompletionDestination({ mode: 'signup', from: '/' }),
    '/tutorial',
  );
});

test('keeps login returning to the protected page that requested auth', () => {
  assert.equal(
    authCompletionDestination({ mode: 'login', from: '/watch' }),
    '/watch',
  );
});

test('starts new signups at video registration when there is no useful return path', () => {
  assert.equal(signupTutorialNextDestination('/'), '/board');
  assert.equal(signupTutorialNextDestination('/signup'), '/board');
});

test('keeps a useful protected return path after the tutorial', () => {
  assert.equal(signupTutorialNextDestination('/watch'), '/watch');
  assert.equal(tutorialNextDestination('/search'), '/search');
});

test('rejects external tutorial destinations', () => {
  assert.equal(tutorialNextDestination('https://example.com'), '/board');
  assert.equal(tutorialNextDestination('//example.com'), '/board');
});
