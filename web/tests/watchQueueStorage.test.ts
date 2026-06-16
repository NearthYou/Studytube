import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_STORAGE_KEY } from '../src/localStudyStorage.ts';
import type { PlaylistDraftState } from '../src/playlistDrafts.ts';
import type { QueueVideo } from '../src/watchQueue.ts';
import {
  addVideosToQueue,
  readPlaylistDraftState,
  readWatchQueue,
  savePlaylistDraftState,
  saveWatchQueue,
} from '../src/watchQueueStorage.ts';

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(seed));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function video(input: Partial<QueueVideo> = {}): QueueVideo {
  return {
    id: 'post-1',
    title: 'React Hooks',
    videoId: 'abc123',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: 'thumb.jpg',
    channelName: 'React Channel',
    summary: 'Hooks summary',
    translatedNotes: 'Hooks notes',
    source: 'board',
    ...input,
  };
}

test('reads and writes watch queues in the current study storage scope', () => {
  const storage = createMemoryStorage({
    [SESSION_STORAGE_KEY]: JSON.stringify({ user: { id: 42 } }),
  });

  saveWatchQueue([video({ learning: { playbackRate: 3 } as never })], storage);

  assert.equal(storage.getItem('studytube.watchQueue:anonymous'), null);
  assert.ok(storage.getItem('studytube.watchQueue:user-42'));
  assert.equal(readWatchQueue(storage)[0].learning?.playbackRate, 1);
});

test('adds selected videos to the scoped queue without losing learning state', () => {
  const storage = createMemoryStorage();
  saveWatchQueue(
    [
      video({
        id: 'post-1',
        learning: {
          captionLanguage: 'en',
          captionsEnabled: false,
          playbackRate: 1.25,
          loop: { enabled: false, manual: false, start: 0, end: 15 },
          marks: [],
        },
      }),
    ],
    storage,
  );

  const nextQueue = addVideosToQueue(
    [video({ id: 'post-1', title: 'Updated' }), video({ id: 'post-2', videoId: 'def456' })],
    video({ id: 'post-1', title: 'Updated' }),
    storage,
  );

  assert.deepEqual(
    nextQueue.map((item) => item.id),
    ['post-1', 'post-2'],
  );
  assert.equal(readWatchQueue(storage)[0].title, 'Updated');
  assert.equal(readWatchQueue(storage)[0].learning?.captionLanguage, 'en');
});

test('ignores malformed legacy watch queue entries that cannot render the player', () => {
  const storage = createMemoryStorage({
    'studytube.watchQueue:anonymous': JSON.stringify([
      { id: 'legacy-1', title: 'Missing video URL', videoId: 'abc123' },
      video({ id: 'post-2', videoId: 'def456' }),
    ]),
  });

  const queue = readWatchQueue(storage);

  assert.deepEqual(
    queue.map((item) => item.id),
    ['post-2'],
  );
});

test('migrates legacy watch queues into playlist drafts', () => {
  const storage = createMemoryStorage();
  saveWatchQueue([video({ id: 'post-1' })], storage);

  const state = readPlaylistDraftState(storage);

  assert.equal(state.drafts.length, 1);
  assert.equal(state.drafts[0].videos[0].id, 'post-1');
  assert.equal(state.activeDraftId, state.drafts[0].id);
});

test('saving playlist draft state also syncs the active watch queue', () => {
  const storage = createMemoryStorage();
  const state: PlaylistDraftState<QueueVideo> = {
    activeDraftId: 'draft-b',
    drafts: [
      {
        id: 'draft-a',
        title: 'A',
        description: '',
        videos: [video({ id: 'post-1' })],
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'draft-b',
        title: 'B',
        description: '',
        videos: [video({ id: 'post-2', videoId: 'def456' })],
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ],
  };

  savePlaylistDraftState(state, storage);

  assert.equal(readWatchQueue(storage)[0].id, 'post-2');
  assert.equal(readPlaylistDraftState(storage).activeDraftId, 'draft-b');
});
