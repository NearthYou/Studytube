import assert from 'node:assert/strict';
import test from 'node:test';
import {
  courseSummaryFromPosts,
  createPersonalizedCoursePrompt,
  createPromptSuggestions,
  filterPlaylists,
  findMatchingCourses,
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
  pace: '하루 20분',
  goal: '퇴근 후 복습',
};

test('builds course prompts from the active learning profile', () => {
  assert.equal(
    createPersonalizedCoursePrompt(profile),
    'React와 영어 회화를 하루 20분 배울 수 있는 코스 추천해줘',
  );
  assert.deepEqual(createPromptSuggestions(profile), [
    'React 입문 코스',
    '퇴근 후 복습',
    '하루 20분 따라갈 수 있는 취미 코스',
  ]);
  assert.equal(
    createPersonalizedCoursePrompt(null),
    '퇴근 후 20분씩 영어 회화를 배우고 싶어',
  );
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
