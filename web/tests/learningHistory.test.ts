import assert from "node:assert/strict";
import test from "node:test";
import {
  learningHistoryProgress,
  readLearningHistory,
  recordLearningHistory,
} from "../src/features/learning/learningHistory.ts";
import type { QueueVideo } from "../src/watchQueue.ts";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function video(id: string): QueueVideo {
  return {
    id,
    title: `영상 ${id}`,
    videoId: id,
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    thumbnailUrl: "thumb.jpg",
    channelName: "채널",
    summary: "",
    translatedNotes: "",
    source: "direct",
  };
}

test("records recent learning by video and restores the last position", () => {
  const memory = storage();
  recordLearningHistory(
    { video: video("cpp-video-1"), positionSeconds: 80, durationSeconds: 100 },
    memory,
  );
  recordLearningHistory(
    { video: video("cpp-video-1"), positionSeconds: 92, durationSeconds: 100 },
    memory,
  );

  const history = readLearningHistory(memory);
  assert.equal(history.length, 1);
  assert.equal(history[0].lastPositionSeconds, 92);
  assert.equal(learningHistoryProgress(history[0]), 92);
});

test("marks a finished video complete without losing its metadata", () => {
  const memory = storage();
  recordLearningHistory(
    {
      video: video("cpp-video-2"),
      positionSeconds: 100,
      durationSeconds: 100,
      completed: true,
    },
    memory,
  );

  assert.equal(readLearningHistory(memory)[0].completed, true);
  assert.equal(learningHistoryProgress(readLearningHistory(memory)[0]), 100);
});
