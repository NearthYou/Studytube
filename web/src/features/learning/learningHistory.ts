import { scopedStudyStorageKeyFromStorage } from "../../localStudyStorage.ts";
import {
  isQueueVideoLike,
  normalizeQueueVideo,
  type QueueVideo,
} from "../../watchQueue.ts";

const HISTORY_STORAGE_KEY = "studytube.learningHistory";
const MAX_HISTORY_ITEMS = 30;

export type LearningHistoryEntry = {
  video: QueueVideo;
  lastPositionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  lastViewedAt: string;
};

export function readLearningHistory(
  storage: Storage = window.localStorage,
): LearningHistoryEntry[] {
  try {
    const raw = storage.getItem(
      scopedStudyStorageKeyFromStorage(HISTORY_STORAGE_KEY, storage),
    );
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[])
      .map(normalizeHistoryEntry)
      .filter((entry): entry is LearningHistoryEntry => Boolean(entry))
      .sort((left, right) => right.lastViewedAt.localeCompare(left.lastViewedAt))
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function recordLearningHistory(
  input: {
    video: QueueVideo;
    positionSeconds: number;
    durationSeconds: number;
    completed?: boolean;
  },
  storage: Storage = window.localStorage,
) {
  const current = readLearningHistory(storage);
  const existing = current.find(
    (entry) => entry.video.videoId === input.video.videoId,
  );
  const durationSeconds = safeSeconds(
    input.durationSeconds || existing?.durationSeconds || 0,
  );
  const lastPositionSeconds = Math.min(
    durationSeconds || Number.MAX_SAFE_INTEGER,
    safeSeconds(input.positionSeconds),
  );
  const completed =
    Boolean(input.completed) ||
    Boolean(existing?.completed) ||
    (durationSeconds > 0 && lastPositionSeconds / durationSeconds >= 0.95);
  const next: LearningHistoryEntry = {
    video: normalizeQueueVideo(input.video),
    lastPositionSeconds,
    durationSeconds,
    completed,
    lastViewedAt: new Date().toISOString(),
  };
  const entries = [
    next,
    ...current.filter((entry) => entry.video.videoId !== input.video.videoId),
  ].slice(0, MAX_HISTORY_ITEMS);
  storage.setItem(
    scopedStudyStorageKeyFromStorage(HISTORY_STORAGE_KEY, storage),
    JSON.stringify(entries),
  );
  return next;
}

export function learningHistoryProgress(entry: LearningHistoryEntry) {
  if (entry.completed) return 100;
  if (entry.durationSeconds <= 0) return 0;
  return Math.min(
    99,
    Math.max(
      0,
      Math.round((entry.lastPositionSeconds / entry.durationSeconds) * 100),
    ),
  );
}

function normalizeHistoryEntry(value: unknown): LearningHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<LearningHistoryEntry>;
  if (!isQueueVideoLike(entry.video)) return null;
  return {
    video: normalizeQueueVideo(entry.video),
    lastPositionSeconds: safeSeconds(entry.lastPositionSeconds),
    durationSeconds: safeSeconds(entry.durationSeconds),
    completed: Boolean(entry.completed),
    lastViewedAt:
      typeof entry.lastViewedAt === "string" && entry.lastViewedAt
        ? entry.lastViewedAt
        : new Date(0).toISOString(),
  };
}

function safeSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}
