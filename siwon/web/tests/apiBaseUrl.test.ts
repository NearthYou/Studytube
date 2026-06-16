import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiBaseUrl } from '../src/api.ts';

test('keeps localhost api base url for local development', () => {
  assert.equal(
    resolveApiBaseUrl('http://localhost:3000', {
      protocol: 'http:',
      hostname: 'localhost',
    }),
    'http://localhost:3000',
  );
});

test('rewrites localhost api base url to the deployed host for remote browsers', () => {
  assert.equal(
    resolveApiBaseUrl('http://localhost:3000', {
      protocol: 'http:',
      hostname: '15.164.98.162',
    }),
    'http://15.164.98.162:3000',
  );
});

test('preserves an explicitly remote api base url', () => {
  assert.equal(
    resolveApiBaseUrl('https://api.example.com', {
      protocol: 'https:',
      hostname: 'study.example.com',
    }),
    'https://api.example.com',
  );
});
