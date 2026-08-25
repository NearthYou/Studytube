import assert from "node:assert/strict";
import test from "node:test";
import {
  readCourseRecommendation,
  saveCourseRecommendation,
} from "../src/features/course/courseRecommendationStorage.ts";
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

const video = (id: string): QueueVideo => ({
  id,
  title: `추천 ${id}`,
  videoId: id,
  videoUrl: `https://www.youtube.com/watch?v=${id}`,
  thumbnailUrl: "thumb.jpg",
  channelName: "채널",
  summary: "",
  translatedNotes: "",
  source: "agent",
});

test("keeps the latest recommendation so the course survives a reload", () => {
  const memory = storage();
  saveCourseRecommendation(
    {
      goal: "C++",
      title: "C++ 기초 코스",
      videos: [video("cpp-1"), video("cpp-2")],
    },
    memory,
  );

  const saved = readCourseRecommendation(memory);
  assert.equal(saved?.goal, "C++");
  assert.deepEqual(saved?.videos.map((item) => item.videoId), ["cpp-1", "cpp-2"]);
});
