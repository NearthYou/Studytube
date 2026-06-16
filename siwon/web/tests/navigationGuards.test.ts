import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldIgnoreSamePageNavigation } from '../src/navigationGuards.ts';

test('ignores static navigator clicks that target the current page path', () => {
  assert.equal(
    shouldIgnoreSamePageNavigation(
      { pathname: '/watch', search: '?videoId=abc123', hash: '' },
      '/watch',
    ),
    true,
  );
  assert.equal(
    shouldIgnoreSamePageNavigation(
      { pathname: '/board/', search: '', hash: '' },
      '/board',
    ),
    true,
  );
});

test('does not ignore navigation to another page path', () => {
  assert.equal(
    shouldIgnoreSamePageNavigation(
      { pathname: '/me/posts', search: '', hash: '' },
      '/me',
    ),
    false,
  );
});

test('only ignores query or hash navigation when the full target already matches', () => {
  assert.equal(
    shouldIgnoreSamePageNavigation(
      { pathname: '/watch', search: '?videoId=abc123', hash: '#memo' },
      '/watch?videoId=abc123#memo',
    ),
    true,
  );
  assert.equal(
    shouldIgnoreSamePageNavigation(
      { pathname: '/watch', search: '?videoId=abc123', hash: '' },
      '/watch?videoId=next',
    ),
    false,
  );
});
