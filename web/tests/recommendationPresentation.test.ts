import assert from "node:assert/strict";
import test from "node:test";
import type { QueueVideo } from "../src/watchQueue.ts";

type PresentRecommendation = (
  video: QueueVideo,
  index: number,
) => {
  stepLabel: string;
  reasonText: string;
};

async function loadPresentation() {
  try {
    const module = (await import(
      "../src/features/course/recommendationPresentation.ts"
    )) as Record<string, unknown>;
    return module.recommendationPresentation as
      | PresentRecommendation
      | undefined;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND"
    ) {
      return undefined;
    }
    throw error;
  }
}

test("recommendation cards explain sequence, captions, and duration in Korean", async () => {
  const present = await loadPresentation();

  assert.equal(
    typeof present,
    "function",
    "추천 이유를 사용자 문장으로 바꾸는 표시 모델이 필요합니다.",
  );
  if (!present) return;

  const video: QueueVideo = {
    id: "agent-SqcY0GlETPk",
    title: "C++ 기초를 20분에 배우기",
    videoId: "SqcY0GlETPk",
    videoUrl: "https://www.youtube.com/watch?v=SqcY0GlETPk",
    thumbnailUrl: "thumb.jpg",
    channelName: "코딩 교실",
    summary: "원문 자막 제공, 약 20분",
    translatedNotes: "",
    source: "youtube-data-api",
    courseRole: "introduction",
    recommendationReasons: [
      "원문 자막 제공",
      "약 20분",
      "처음 배우기 좋은 난이도",
    ],
  };

  assert.deepEqual(present(video, 0), {
    stepLabel: "1단계 입문",
    reasonText: "원문 자막 제공 / 약 20분 / 처음 배우기 좋은 난이도",
  });
});

test("recommendation cards do not invent a reason when metadata is missing", async () => {
  const present = await loadPresentation();

  assert.equal(typeof present, "function");
  if (!present) return;

  const video: QueueVideo = {
    id: "mcp-sHS1z9Pr4v8",
    title: "중국어 회화",
    videoId: "sHS1z9Pr4v8",
    videoUrl: "https://www.youtube.com/watch?v=sHS1z9Pr4v8",
    thumbnailUrl: "thumb.jpg",
    channelName: "언어 교실",
    summary: "",
    translatedNotes: "",
    source: "youtube-search-page",
  };

  assert.deepEqual(present(video, 1), {
    stepLabel: "2번째 영상",
    reasonText: "",
  });
});
