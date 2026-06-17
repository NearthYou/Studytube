import {
  normalizePlaylistDraftState,
  selectActivePlaylistDraft,
  type PlaylistDraftState,
} from './playlistDrafts.ts';
import { scopedStudyStorageKeyFromStorage } from './localStudyStorage.ts';
import {
  isQueueVideoLike,
  mergeVideosIntoQueue,
  normalizeQueueVideo,
  type QueueVideo,
} from './watchQueue.ts';

const QUEUE_STORAGE_KEY = 'studytube.watchQueue';
const PLAYLIST_DRAFTS_STORAGE_KEY = 'studytube.playlistDrafts';
const ACTIVE_PLAYLIST_DRAFT_STORAGE_KEY = 'studytube.activePlaylistDraftId';

export function readWatchQueue(storage: Storage = window.localStorage): QueueVideo[] {
  try {
    const raw = storage.getItem(scopedStorageKey(storage, QUEUE_STORAGE_KEY));
    return raw
      ? (JSON.parse(raw) as unknown[])
          .filter(isQueueVideoLike)
          .map((video) => normalizeQueueVideo(video))
      : [];
  } catch {
    return [];
  }
}

export function saveWatchQueue(
  queue: QueueVideo[],
  storage: Storage = window.localStorage,
) {
  storage.setItem(
    scopedStorageKey(storage, QUEUE_STORAGE_KEY),
    JSON.stringify(queue.map((video) => normalizeQueueVideo(video))),
  );
}

export function addVideosToQueue(
  videos: QueueVideo[],
  selectedVideo: QueueVideo,
  storage: Storage = window.localStorage,
) {
  const existingQueue = readWatchQueue(storage);
  const nextQueue = mergeVideosIntoQueue(existingQueue, videos, selectedVideo);

  saveWatchQueue(nextQueue, storage);

  return nextQueue;
}

export function readPlaylistDraftState(
  storage: Storage = window.localStorage,
): PlaylistDraftState<QueueVideo> {
  try {
    const raw = storage.getItem(scopedStorageKey(storage, PLAYLIST_DRAFTS_STORAGE_KEY));
    const activeDraftId = storage.getItem(
      scopedStorageKey(storage, ACTIVE_PLAYLIST_DRAFT_STORAGE_KEY),
    );
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;

    return normalizePlaylistDraftState(parsed, {
      activeDraftId,
      fallbackVideos: readWatchQueue(storage),
      normalizeVideo: (video) =>
        isQueueVideoLike(video) ? normalizeQueueVideo(video) : null,
    });
  } catch {
    return normalizePlaylistDraftState(null, {
      fallbackVideos: readWatchQueue(storage),
      normalizeVideo: (video) =>
        isQueueVideoLike(video) ? normalizeQueueVideo(video) : null,
    });
  }
}

export function savePlaylistDraftState(
  state: PlaylistDraftState<QueueVideo>,
  storage: Storage = window.localStorage,
) {
  storage.setItem(
    scopedStorageKey(storage, PLAYLIST_DRAFTS_STORAGE_KEY),
    JSON.stringify(
      state.drafts.map((draft) => ({
        ...draft,
        videos: draft.videos.map((video) => normalizeQueueVideo(video)),
      })),
    ),
  );
  storage.setItem(
    scopedStorageKey(storage, ACTIVE_PLAYLIST_DRAFT_STORAGE_KEY),
    state.activeDraftId,
  );
  saveWatchQueue(selectActivePlaylistDraft(state).videos, storage);
}

function scopedStorageKey(storage: Storage, baseKey: string) {
  return scopedStudyStorageKeyFromStorage(baseKey, storage);
}
