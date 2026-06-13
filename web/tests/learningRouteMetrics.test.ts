import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audienceLabel,
  difficultyLabel,
  estimateRouteMinutes,
  estimateVideoMinutes,
  sampleCaptionSegmentsForSummary,
} from '../src/learningRouteMetrics.ts';
import type { StudyPost } from '../src/types.ts';

function post(input: Partial<StudyPost> = {}): StudyPost {
  return {
    id: 1,
    authorId: 1,
    authorName: 'Demo',
    title: 'React Hooks',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: 'thumb.jpg',
    channelName: 'React Channel',
    summary: 'Short summary',
    translatedNotes: 'Short notes',
    tags: [],
    comments: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...input,
  };
}

test('estimates route and video minutes from available post text', () => {
  assert.equal(estimateVideoMinutes(post()), 11);
  assert.equal(estimateRouteMinutes([post(), post({ id: 2 })], 0), 22);
  assert.equal(estimateRouteMinutes([], 3), 42);
});

test('labels learning difficulty and audience from tags', () => {
  assert.equal(difficultyLabel(['beginner']), '입문');
  assert.equal(difficultyLabel(['pgvector']), '실전');
  assert.equal(difficultyLabel(['react']), '중급');
  assert.equal(audienceLabel(['frontend']), '프론트 학습자');
  assert.equal(audienceLabel(['fastapi']), '실습형 학습자');
  assert.equal(audienceLabel(['rag']), 'AI 서비스 빌더');
  assert.equal(audienceLabel(['music']), '새 주제 입문자');
});

test('samples dense caption segments for bounded summary requests', () => {
  const segments = Array.from({ length: 200 }, (_, index) => ({
    start: index,
    end: index + 1,
    text: `Caption ${index}`,
  }));
  const sampled = sampleCaptionSegmentsForSummary(segments);

  assert.equal(sampled.length, 67);
  assert.deepEqual(
    sampled.slice(0, 3).map((segment) => segment.start),
    [0, 3, 6],
  );
});
