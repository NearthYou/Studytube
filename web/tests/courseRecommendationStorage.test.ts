import assert from "node:assert/strict";
import test from "node:test";
import {
  readCourseRecommendation,
  saveCourseRecommendation,
} from "../src/features/course/courseRecommendationStorage.ts";
import * as recommendationStorage from "../src/features/course/courseRecommendationStorage.ts";
import type { Course } from "../src/types.ts";
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

test("clears a prepared recommendation after its Course is saved", () => {
  const memory = storage();
  saveCourseRecommendation(
    {
      goal: "C++",
      title: "C++ 기초 코스",
      videos: [video("cpp-1"), video("cpp-2")],
    },
    memory,
  );
  const clear = (
    recommendationStorage as unknown as {
      clearCourseRecommendation?: (storage: Storage) => void;
    }
  ).clearCourseRecommendation;

  assert.equal(typeof clear, "function");
  clear?.(memory);
  assert.equal(readCourseRecommendation(memory), null);
});

test("recognizes a prepared recommendation already saved as a Course", () => {
  const memory = storage();
  const recommendation = saveCourseRecommendation(
    {
      goal: "C++",
      title: "C++ 기초 코스",
      videos: [video("cpp-video-1"), video("cpp-video-2")],
    },
    memory,
  );
  const savedCourse: Course = {
    id: 7,
    title: "C++ 기초 코스",
    description: "",
    visibility: "private",
    status: "published",
    version: 2,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    publishedAt: "2026-08-27T00:00:00.000Z",
    steps: recommendation.videos.map((item, index) => ({
      id: String(index + 1),
      position: index + 1,
      sourcePostId: null,
      snapshot: {
        title: item.title,
        videoUrl: item.videoUrl,
        thumbnailUrl: item.thumbnailUrl,
        channelName: item.channelName,
      },
    })),
    feedback: [],
  };
  const matches = (
    recommendationStorage as unknown as {
      isCourseRecommendationSaved?: (
        recommendation: typeof recommendation,
        courses: Course[],
      ) => boolean;
    }
  ).isCourseRecommendationSaved;

  assert.equal(typeof matches, "function");
  assert.equal(matches?.(recommendation, [savedCourse]), true);
  assert.equal(
    matches?.({ ...recommendation, title: "다른 코스" }, [savedCourse]),
    false,
  );
});
