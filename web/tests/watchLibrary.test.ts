import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlaylistDraft } from '../src/playlistDrafts.ts';
import type { Playlist, StudyPost } from '../src/types.ts';
import {
  buildWatchPlaylistChoices,
  findMatchingWatchPlaylistChoice,
} from '../src/watchLibrary.ts';

type TestVideo = {
  id: string;
  title: string;
};

function post(id: number, title: string): StudyPost {
  return {
    id,
    authorId: 1,
    authorName: 'Demo',
    title,
    videoUrl: `https://youtube.com/watch?v=video${id}`,
    thumbnailUrl: `thumb-${id}.jpg`,
    channelName: 'Channel',
    summary: title,
    translatedNotes: title,
    tags: [],
    comments: [],
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

function playlist(id: number, title: string, postIds: number[]): Playlist {
  return {
    id,
    ownerId: 1,
    title,
    description: '',
    postIds,
    feedback: [],
    createdAt: '2026-06-11T00:00:00.000Z',
  };
}

test('builds watch choices from saved playlists and local drafts', () => {
  const draft: PlaylistDraft<TestVideo> = {
    id: 'draft-a',
    title: 'Draft Course',
    description: '',
    videos: [{ id: 'draft-video', title: 'Draft Video' }],
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
  const choices = buildWatchPlaylistChoices({
    savedPlaylists: [playlist(1, 'Saved Course', [1, 2])],
    posts: [post(1, 'React'), post(2, 'FastAPI')],
    drafts: [draft],
    videoFromPost: (item) => ({ id: `post-${item.id}`, title: item.title }),
  });

  assert.deepEqual(
    choices.map((choice) => [
      choice.id,
      choice.title,
      choice.description,
      choice.metaLabel,
      choice.videos.length,
    ]),
    [
      [
        'saved-1',
        'Saved Course',
        '저장된 학습 플레이리스트입니다.',
        '2개 영상 · 저장됨',
        2,
      ],
      [
        'draft-draft-a',
        'Draft Course',
        '아직 보드에 올리지 않은 작업 초안입니다.',
        '1개 영상 · 초안',
        1,
      ],
    ],
  );
});

test('skips saved playlists when their posts are unavailable', () => {
  const choices = buildWatchPlaylistChoices<TestVideo>({
    savedPlaylists: [playlist(1, 'Missing Course', [99])],
    posts: [],
    drafts: [],
    videoFromPost: (item) => ({ id: `post-${item.id}`, title: item.title }),
  });

  assert.deepEqual(choices, []);
});

test('finds the watch playlist that matches the current queue order', () => {
  const choices = [
    {
      id: 'saved-1',
      kind: 'saved' as const,
      title: 'React',
      description: '',
      metaLabel: '2 videos',
      videos: [
        { id: 'post-1', title: 'Hooks' },
        { id: 'post-2', title: 'Query' },
      ],
    },
  ];
  const match = findMatchingWatchPlaylistChoice(
    choices,
    [
      { id: 'post-1', title: 'Hooks' },
      { id: 'post-2', title: 'Query' },
    ],
    (video) => video.id,
  );

  assert.equal(match?.id, 'saved-1');
});
