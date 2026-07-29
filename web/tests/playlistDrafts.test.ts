import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPlaylistDraft,
  normalizePlaylistDraftState,
  patchActivePlaylistDraft,
  removePlaylistDraft,
  selectActivePlaylistDraft,
} from '../src/playlistDrafts.ts';

type TestVideo = {
  id: string;
  title: string;
};

function normalizeVideo(video: unknown): TestVideo | null {
  if (
    video &&
    typeof video === 'object' &&
    'id' in video &&
    'title' in video &&
    typeof video.id === 'string' &&
    typeof video.title === 'string'
  ) {
    return { id: video.id, title: video.title };
  }

  return null;
}

test('migrates a legacy single queue into the first playlist draft', () => {
  const state = normalizePlaylistDraftState<TestVideo>(null, {
    fallbackVideos: [{ id: 'post-1', title: 'React Hooks' }],
    normalizeVideo,
    createId: () => 'draft-1',
    now: '2026-06-11T00:00:00.000Z',
  });

  assert.equal(state.activeDraftId, 'draft-1');
  assert.equal(state.drafts.length, 1);
  assert.deepEqual(selectActivePlaylistDraft(state).videos, [
    { id: 'post-1', title: 'React Hooks' },
  ]);
});

test('keeps multiple drafts and honors the active draft id', () => {
  const state = normalizePlaylistDraftState<TestVideo>(
    {
      drafts: [
        { id: 'draft-a', title: 'React', videos: [{ id: 'post-1', title: 'Hooks' }] },
        { id: 'draft-b', title: 'FastAPI', videos: [{ id: 'post-2', title: 'API' }] },
      ],
    },
    {
      activeDraftId: 'draft-b',
      normalizeVideo,
      now: '2026-06-11T00:00:00.000Z',
    },
  );

  assert.equal(selectActivePlaylistDraft(state).title, 'FastAPI');
  assert.deepEqual(selectActivePlaylistDraft(state).videos, [
    { id: 'post-2', title: 'API' },
  ]);
});

test('keeps every private playlist available for the learning playlist flow', () => {
  const state = {
    activeDraftId: 'draft-b',
    drafts: [
      createPlaylistDraft<TestVideo>({
        id: 'draft-a',
        title: 'React',
        videos: [{ id: 'post-1', title: 'Hooks' }],
      }),
      createPlaylistDraft<TestVideo>({
        id: 'draft-b',
        title: 'FastAPI',
        videos: [{ id: 'post-2', title: 'API' }],
      }),
    ],
  };

  const nextState = normalizePlaylistDraftState<TestVideo>(state, {
    activeDraftId: state.activeDraftId,
    normalizeVideo,
    now: '2026-06-11T00:00:00.000Z',
  });

  assert.equal(nextState.activeDraftId, 'draft-b');
  assert.deepEqual(
    nextState.drafts.map((draft) => [draft.id, draft.title]),
    [
      ['draft-a', 'React'],
      ['draft-b', 'FastAPI'],
    ],
  );
});

test('patches only the active draft', () => {
  const state = {
    activeDraftId: 'draft-b',
    drafts: [
      createPlaylistDraft<TestVideo>({ id: 'draft-a', title: 'React' }),
      createPlaylistDraft<TestVideo>({ id: 'draft-b', title: 'FastAPI' }),
    ],
  };

  const nextState = patchActivePlaylistDraft(
    state,
    { title: 'FastAPI Backend', videos: [{ id: 'post-2', title: 'API' }] },
    '2026-06-11T00:00:00.000Z',
  );

  assert.equal(nextState.drafts[0].title, 'React');
  assert.equal(selectActivePlaylistDraft(nextState).title, 'FastAPI Backend');
  assert.equal(selectActivePlaylistDraft(nextState).videos.length, 1);
  assert.equal(selectActivePlaylistDraft(nextState).revision, 2);
});

test('preserves a persisted draft revision across normalization', () => {
  const state = normalizePlaylistDraftState<TestVideo>(
    {
      drafts: [
        {
          id: 'draft-a',
          title: 'React',
          videos: [],
          revision: 8,
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z',
        },
      ],
    },
    { normalizeVideo, now: '2026-06-12T00:00:00.000Z' },
  );

  assert.equal(state.drafts[0].revision, 8);
  assert.equal(state.drafts[0].createdAt, '2026-06-10T00:00:00.000Z');
  assert.equal(state.drafts[0].updatedAt, '2026-06-11T00:00:00.000Z');
});

test('removes the active draft and selects the next available draft', () => {
  const state = {
    activeDraftId: 'draft-a',
    drafts: [
      createPlaylistDraft<TestVideo>({ id: 'draft-a', title: 'React' }),
      createPlaylistDraft<TestVideo>({ id: 'draft-b', title: 'FastAPI' }),
    ],
  };

  const nextState = removePlaylistDraft(
    state,
    'draft-a',
    createPlaylistDraft<TestVideo>({ id: 'replacement' }),
  );

  assert.equal(nextState.activeDraftId, 'draft-b');
  assert.deepEqual(
    nextState.drafts.map((draft) => draft.id),
    ['draft-b'],
  );
});
