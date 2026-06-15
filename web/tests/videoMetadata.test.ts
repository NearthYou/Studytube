import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTags, limitVideoTags } from '../src/videoMetadata.ts';

test('derived video tags are capped at three unique tags', () => {
  assert.deepEqual(
    deriveTags('React hooks frontend state effects javascript tutorial'),
    ['react', 'hooks', 'frontend'],
  );
});

test('manual video tags are normalized and capped at three tags', () => {
  assert.deepEqual(
    limitVideoTags([' react ', 'hooks', 'react', 'frontend', 'javascript']),
    ['react', 'hooks', 'frontend'],
  );
});
