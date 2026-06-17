import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveTags,
  isPlayableYouTubeVideoId,
  limitVideoTags,
  playableYouTubeVideoId,
} from '../src/videoMetadata.ts';

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

test('distinguishes playable YouTube ids from internal queue ids', () => {
  assert.equal(isPlayableYouTubeVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isPlayableYouTubeVideoId('novnyCaa7To'), true);
  assert.equal(isPlayableYouTubeVideoId('codexmqc3300r'), false);
  assert.equal(isPlayableYouTubeVideoId('abc123'), false);
  assert.equal(
    isPlayableYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    false,
  );
});

test('resolves playable YouTube ids only from URL and fallback sources', () => {
  assert.equal(
    playableYouTubeVideoId(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'internal-id',
    ),
    'dQw4w9WgXcQ',
  );
  assert.equal(
    playableYouTubeVideoId(
      'https://www.youtube.com/watch?v=codexmqc3300r',
      'codexmqc3300r',
    ),
    null,
  );
  assert.equal(
    playableYouTubeVideoId('https://example.com/not-youtube', 'novnyCaa7To'),
    'novnyCaa7To',
  );
});
