import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaylistDraft } from '../src/playlistDrafts.ts';
import {
  buildPlaylistAddTargets,
  clampPlaylistManagementPage,
  editingPlaylistEditorFromPlaylist,
  filterManagedPlaylists,
  nextPlaylistManagementPageAfterDelete,
} from '../src/playlistManagement.ts';
import type { Playlist, StudyPost } from '../src/types.ts';

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
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...input,
  };
}

function playlist(id: number, input: Partial<Playlist> = {}): Playlist {
  return {
    id,
    ownerId: 1,
    title: `Playlist ${id}`,
    description: '',
    postIds: [],
    feedback: [],
    createdAt: '2026-06-15T00:00:00.000Z',
    ...input,
  };
}

test('filters managed playlists by playlist copy and included video metadata', () => {
  const posts = [
    post(1, {
      title: 'React Hooks',
      channelName: 'Frontend Lab',
      tags: ['react', 'hooks'],
    }),
    post(2, {
      title: 'NestJS Providers',
      channelName: 'Backend Lab',
      tags: ['nestjs'],
    }),
  ];
  const playlists = [
    playlist(1, {
      title: 'Frontend Board Post',
      description: 'React learning path',
      postIds: [1],
    }),
    playlist(2, {
      title: 'Backend Board Post',
      description: 'Server learning path',
      postIds: [2],
    }),
  ];

  assert.deepEqual(
    filterManagedPlaylists(playlists, posts, 'hooks').map((item) => item.id),
    [1],
  );
  assert.deepEqual(
    filterManagedPlaylists(playlists, posts, 'backend lab').map(
      (item) => item.id,
    ),
    [2],
  );
});

test('builds a playlist edit draft from a board playlist post', () => {
  assert.deepEqual(
    editingPlaylistEditorFromPlaylist(
      playlist(1, {
        title: 'React path',
        description: 'Hooks first, query second.',
      }),
    ),
    {
      title: 'React path',
      description: 'Hooks first, query second.',
    },
  );
});

test('keeps playlist management pagination bounded after deletion', () => {
  assert.equal(clampPlaylistManagementPage(0, 5, 9), 1);
  assert.equal(clampPlaylistManagementPage(11, 5, 9), 3);
  assert.equal(nextPlaylistManagementPageAfterDelete(3, 5, 11, 1), 2);
  assert.equal(nextPlaylistManagementPageAfterDelete(2, 5, 9, 4), 2);
});

test('builds add-to-playlist targets from private learning playlists', () => {
  const targets = buildPlaylistAddTargets({
    activeDraftId: 'draft-b',
    drafts: [
      createPlaylistDraft({
        id: 'draft-a',
        title: 'React',
        videos: [{ id: 'post-1', title: 'Hooks' }],
      }),
      createPlaylistDraft({
        id: 'draft-b',
        title: 'sad',
        videos: [
          { id: 'post-2', title: 'FastAPI' },
          { id: 'post-3', title: 'NestJS' },
        ],
      }),
    ],
  });

  assert.deepEqual(
    targets.map((target) => [target.id, target.kind, target.title]),
    [
      ['draft-draft-b', 'draft', 'sad'],
      ['draft-draft-a', 'draft', 'React'],
    ],
  );
  assert.match(targets[0].description, /공개 안 함/);
  assert.match(targets[1].description, /비공개/);
});
