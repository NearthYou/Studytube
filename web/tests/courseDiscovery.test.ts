import assert from 'node:assert/strict';
import test from 'node:test';
import {
  courseSummaryFromPosts,
  createPersonalizedCoursePrompt,
  createPromptSuggestions,
  filterPlaylists,
  findMatchingCourses,
  hasLearningPreferences,
  postsForPlaylistIds,
  tagsFromPosts,
} from '../src/courseDiscovery.ts';
import type { LearningPreferences, Playlist, StudyPost } from '../src/types.ts';

function post(id: number, input: Partial<StudyPost> = {}): StudyPost {
  return {
    id,
    authorId: 1,
    authorName: 'Demo',
    title: `Video ${id}`,
    videoUrl: `https://www.youtube.com/watch?v=video${id}`,
    thumbnailUrl: `thumb-${id}.jpg`,
    channelName: 'Channel',
    summary: `Summary ${id}`,
    translatedNotes: `Notes ${id}`,
    tags: [],
    comments: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...input,
  };
}

function playlist(id: number, input: Partial<Playlist> = {}): Playlist {
  return {
    id,
    ownerId: 1,
    title: `Course ${id}`,
    description: '',
    postIds: [],
    feedback: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    ...input,
  };
}

const profile: LearningPreferences = {
  interests: ['React', '영어 회화'],
  pace: '20',
  goal: '퇴근 후 복습',
};

test('builds course prompts from the active learning profile', () => {
  assert.equal(hasLearningPreferences(profile), true);
  assert.equal(
    createPersonalizedCoursePrompt(profile),
    '관심사: React, 영어 회화\n학습 속도: 하루 20분\n학습 목표: 퇴근 후 복습\n실제로 재생할 수 있는 YouTube 영상 2~4개를 쉬운 순서로 추천해줘.',
  );
  assert.deepEqual(createPromptSuggestions(profile), [
    'React 기초부터 배우기',
    'React 따라 하며 익히기',
    'React 핵심만 복습하기',
  ]);
  assert.equal(
    createPersonalizedCoursePrompt(profile, '중국어 여행 회화'),
    '배울 내용: 중국어 여행 회화\n관심사: React, 영어 회화\n학습 속도: 하루 20분\n학습 목표: 퇴근 후 복습\n실제로 재생할 수 있는 YouTube 영상 2~4개를 쉬운 순서로 추천해줘.',
  );
});

test('turns legacy pace values into a clear daily learning time', async () => {
  const discovery = await import('../src/courseDiscovery.ts');
  assert.equal(typeof discovery.normalizeLearningPace, 'function');
  assert.equal(typeof discovery.learningTimeSelection, 'function');
  assert.equal(typeof discovery.paceForPreferenceSave, 'function');
  if (
    typeof discovery.normalizeLearningPace !== 'function' ||
    typeof discovery.learningTimeSelection !== 'function' ||
    typeof discovery.paceForPreferenceSave !== 'function'
  ) {
    return;
  }
  assert.equal(discovery.normalizeLearningPace('20'), '하루 20분');
  assert.equal(discovery.normalizeLearningPace('하루 1시간'), '하루 1시간');
  assert.equal(discovery.learningTimeSelection('20'), '하루 20분');
  assert.equal(discovery.learningTimeSelection('빠르게'), null);
  assert.equal(discovery.paceForPreferenceSave('주 3회'), '주 3회');
  assert.equal(discovery.paceForPreferenceSave(''), '하루 20분');
});

test('summarizes only recommendation settings the learner can understand', async () => {
  const discovery = await import('../src/courseDiscovery.ts');
  assert.equal(typeof discovery.learningPreferenceSummary, 'function');
  if (typeof discovery.learningPreferenceSummary !== 'function') return;
  assert.equal(
    discovery.learningPreferenceSummary({
      interests: ['React'],
      pace: '20',
      goal: '에아',
    }),
    'React 위주로 하루 20분에 맞춰 추천해요.',
  );
  assert.equal(
    discovery.learningPreferenceSummary({
      interests: ['영어 회화'],
      pace: '빠르게',
      goal: '면접 준비',
    }),
    '영어 회화 위주로 추천해요.',
  );
});

test('keeps an unknown legacy pace when recommendation settings are saved', async () => {
  const discovery = await import('../src/courseDiscovery.ts');
  assert.equal(typeof discovery.learningPreferencesFromDraft, 'function');
  if (typeof discovery.learningPreferencesFromDraft !== 'function') return;

  assert.deepEqual(
    discovery.learningPreferencesFromDraft({
      interests: ' React, 영어 회화 ',
      pace: '주 3회',
      goal: ' 면접 준비 ',
    }),
    {
      interests: ['React', '영어 회화'],
      pace: '주 3회',
      goal: '면접 준비',
    },
  );
});

test('does not show temporary prompts before a learner sets preferences', () => {
  const emptyProfile: LearningPreferences = {
    interests: [],
    pace: '',
    goal: '',
  };

  assert.equal(hasLearningPreferences(emptyProfile), false);
  assert.equal(createPersonalizedCoursePrompt(emptyProfile), '');
  assert.equal(
    createPersonalizedCoursePrompt(emptyProfile, '중국어 여행 회화'),
    '배울 내용: 중국어 여행 회화\n실제로 재생할 수 있는 YouTube 영상 2~4개를 쉬운 순서로 추천해줘.',
  );
  assert.deepEqual(createPromptSuggestions(emptyProfile), []);
  assert.equal(createPersonalizedCoursePrompt(null), '');
});

test('finds matching courses by playlist and post content', () => {
  const posts = [
    post(1, { title: 'React Hooks', tags: ['frontend'] }),
    post(2, { title: 'FastAPI', tags: ['backend'] }),
  ];
  const matches = findMatchingCourses(
    [
      playlist(1, { title: 'Frontend Path', postIds: [1] }),
      playlist(2, { title: 'Backend Path', postIds: [2] }),
    ],
    posts,
    'react frontend',
  );

  assert.deepEqual(
    matches.map((item) => item.id),
    [1],
  );
});

test('filters playlists and derives display metadata from post ids', () => {
  const posts = [
    post(1, { title: 'React Hooks', tags: ['react', 'frontend'] }),
    post(2, { title: 'FastAPI', tags: ['api'] }),
  ];
  const playlists = [
    playlist(1, { title: 'React Course', postIds: [1] }),
    playlist(2, { title: 'Backend Course', postIds: [2] }),
  ];
  const filtered = filterPlaylists(playlists, posts, 'hooks');
  const playlistPosts = postsForPlaylistIds([1, 99], posts);

  assert.deepEqual(filtered.map((item) => item.id), [1]);
  assert.deepEqual(playlistPosts.map((item) => item.id), [1]);
  assert.deepEqual(tagsFromPosts(playlistPosts), ['react', 'frontend']);
  assert.equal(courseSummaryFromPosts(playlistPosts), '1. React Hooks');
  assert.equal(
    courseSummaryFromPosts([]),
    '아직 영상 정보가 연결되지 않은 학습 코스입니다.',
  );
});
