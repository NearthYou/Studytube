import assert from 'node:assert/strict';
import test from 'node:test';
import { courseAnalysisSectionsFromPosts } from '../src/courseAnalysis.ts';

test('formats one Korean analysis section per video', () => {
  const sections = courseAnalysisSectionsFromPosts([
    {
      summary:
        'A practical React hooks lesson covering useState, useEffect, useMemo, and useCallback.',
      translatedNotes:
        '리액트 훅의 상태 관리, 효과 처리, 메모이제이션, 커스텀 훅을 실제 예제로 복습합니다.',
    },
    {
      summary:
        'Explains server state, caching, refetching, query keys, and mutation flows for React applications.',
      translatedNotes:
        '서버 상태 관리, 캐싱, 재조회, 쿼리 키, 변경 요청 흐름을 리액트 앱 기준으로 정리합니다.',
    },
  ]);

  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map((section) => section.heading),
    ['영상 1', '영상 2'],
  );
  assert.match(sections[0].body, /리액트 훅/);
  assert.match(sections[1].body, /서버 상태 관리/);
  assert.doesNotMatch(
    sections.map((section) => section.body).join(' '),
    /A practical|Explains server state/,
  );
});

test('uses a Korean fallback when a video has no Korean analysis', () => {
  const sections = courseAnalysisSectionsFromPosts([
    {
      summary: 'This lesson only has an English summary.',
      translatedNotes: '',
    },
  ]);

  assert.equal(sections[0].heading, '영상 1');
  assert.match(sections[0].body, /AI 분석 요약이 아직 부족합니다/);
  assert.doesNotMatch(sections[0].body, /English summary/);
});
