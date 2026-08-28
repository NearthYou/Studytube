import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { QueueVideo } from "../src/watchQueue.ts";

function video(position: number): QueueVideo {
  return {
    id: `course-video-${position}`,
    title: position === 1 ? "첫 영상" : "다음 영상",
    videoId: position === 1 ? "SqcY0GlETPk" : "sHS1z9Pr4v8",
    videoUrl: `https://www.youtube.com/watch?v=${position === 1 ? "SqcY0GlETPk" : "sHS1z9Pr4v8"}`,
    thumbnailUrl: `https://img.example/course-${position}.jpg`,
    channelName: "Study Channel",
    summary: "",
    translatedNotes: "",
    source: "course",
    course: {
      id: "course-7",
      title: "여행 회화 코스",
      position,
      total: 2,
    },
  };
}

async function loadModel() {
  try {
    return await import("../src/features/learning/courseNavigatorModel.ts");
  } catch {
    assert.fail("코스 영상 선택 순서를 계산하는 모듈이 없습니다.");
  }
}

test("Course navigator model exposes every video around the current step", async () => {
  const { courseNavigatorModel } = await loadModel();
  const result = courseNavigatorModel(
    [video(2), video(1)],
    "SqcY0GlETPk",
  );

  assert.equal(result.currentIndex, 0);
  assert.equal(result.current.title, "첫 영상");
  assert.equal(result.previous, undefined);
  assert.equal(result.next?.title, "다음 영상");
  assert.deepEqual(
    result.orderedVideos.map((item) => item.title),
    ["첫 영상", "다음 영상"],
  );
});

test("Course navigator renders a thumbnail picker for direct selection", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
  const source = readFileSync(
    resolve(root, "features/learning/CourseNavigator.tsx"),
    "utf8",
  );

  assert.match(source, /className="course-video-picker-toggle"/);
  assert.match(source, /aria-expanded=\{pickerOpen\}/);
  assert.match(source, /\{pickerOpen && \(/);
  assert.match(source, /className="course-video-picker-list"/);
  assert.match(source, /video\.thumbnailUrl/);
  assert.match(source, /aria-current=/);
  assert.match(source, /영상 선택/);
  assert.match(source, /코스 목록/);
  assert.doesNotMatch(source, /<details/);
});
