import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiBaseUrl } from '../src/api.ts';

test('keeps localhost api base url for local development', () => {
  assert.equal(
    resolveApiBaseUrl('http://localhost:3000', {
      hostname: 'localhost',
    }),
    'http://localhost:3000',
  );
});

test('uses the same-origin api edge when a remote build has no explicit api url', () => {
  assert.equal(
    resolveApiBaseUrl(undefined, {
      hostname: 'study.example.com',
    }),
    '/api',
  );
});

test('uses the same-origin api edge when a remote build contains a localhost api url', () => {
  assert.equal(
    resolveApiBaseUrl('http://localhost:3000', {
      hostname: 'study.example.com',
    }),
    '/api',
  );
});

test('preserves an explicitly remote api base url', () => {
  assert.equal(
    resolveApiBaseUrl('https://api.example.com', {
      hostname: 'study.example.com',
    }),
    'https://api.example.com',
  );
});
