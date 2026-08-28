import assert from "node:assert/strict";
import test from "node:test";
import {
  captionPairAt,
  canRetryCaptions,
  captionPhaseMessage,
  mergeCaptionState,
  needsInitialCaptionRepair,
  quizPreparation,
  type ProgressiveCaptionState,
} from "../src/features/learning/captionState.ts";

const pending: ProgressiveCaptionState = {
  generation: 3,
  phase: "translation_pending",
  sourceLanguage: "zh",
  sourceSegments: [{ start: 0, end: 4, text: "你好" }],
  koreanSegments: [],
  stale: false,
};

test("adds Korean translation later without replacing source captions", () => {
  const next = mergeCaptionState(pending, {
    generation: 3,
    phase: "index_pending",
    sourceLanguage: "zh",
    sourceSegments: [],
    koreanSegments: [{ start: 0, end: 4, text: "안녕하세요" }],
    stale: false,
  });

  assert.deepEqual(captionPairAt(next, 2), {
    source: "你好",
    korean: "안녕하세요",
  });
});

test("ignores a stale caption generation", () => {
  const next = mergeCaptionState(pending, {
    generation: 2,
    phase: "failed",
    sourceLanguage: "en",
    sourceSegments: [{ start: 0, end: 4, text: "old" }],
    koreanSegments: [],
    stale: true,
  });

  assert.deepEqual(next, pending);
});

test("opens a quiz only after duration and full coverage are known", () => {
  assert.deepEqual(quizPreparation(pending), {
    ready: false,
    needsCaptions: false,
    message: "영상 길이를 확인하고 있어요.",
  });
  const fiveSegments = Array.from({ length: 5 }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 5,
    text: `sentence ${index + 1}`,
  }));
  const indexing = {
    ...pending,
    phase: "index_pending" as const,
    sourceSegments: fiveSegments,
  };
  assert.deepEqual(quizPreparation(indexing, 120), {
    ready: false,
    needsCaptions: false,
    message: "영상 전체 자막을 준비하고 있어요. 퀴즈는 전체 내용에서 출제합니다.",
  });
  assert.deepEqual(quizPreparation(indexing, 50), {
    ready: true,
    needsCaptions: false,
    message: "영상 전체 내용으로 퀴즈를 시작할 수 있습니다.",
  });
  assert.deepEqual(quizPreparation({ ...indexing, phase: "complete" }, 50), {
    ready: true,
    needsCaptions: false,
    message: "영상 전체 내용으로 퀴즈를 시작할 수 있습니다.",
  });
});

test("live captions must span the full video before quiz generation", () => {
  const segments = Array.from({ length: 5 }, (_, index) => ({
    start: index * 4,
    end: index * 4 + 3,
    text: `live sentence ${index + 1}`,
  }));
  const live = {
    ...pending,
    phase: "partial" as const,
    sourceSegments: segments,
  };

  assert.deepEqual(quizPreparation(live, 60), {
    ready: false,
    needsCaptions: false,
    message: "영상 전체 자막을 준비하고 있어요. 퀴즈는 전체 내용에서 출제합니다.",
  });
  assert.deepEqual(quizPreparation(live, 20), {
    ready: true,
    needsCaptions: false,
    message: "영상 전체 내용으로 퀴즈를 시작할 수 있습니다.",
  });
});

test("quiz waits for caption coverage across the whole video", () => {
  const openingOnly = {
    ...pending,
    phase: "complete" as const,
    sourceSegments: Array.from({ length: 5 }, (_, index) => ({
      start: index * 10,
      end: index * 10 + 5,
      text: `opening ${index + 1}`,
    })),
  };
  assert.deepEqual(quizPreparation(openingOnly, 120), {
    ready: false,
    needsCaptions: false,
    message: "영상 전체 자막을 확인할 수 없어 퀴즈를 만들지 않았어요.",
  });

  const fullVideo = {
    ...openingOnly,
    sourceSegments: [
      { start: 0, end: 5, text: "opening" },
      { start: 25, end: 30, text: "first point" },
      { start: 55, end: 60, text: "middle" },
      { start: 85, end: 90, text: "application" },
      { start: 115, end: 120, text: "ending" },
    ],
  };
  assert.deepEqual(quizPreparation(fullVideo, 120), {
    ready: true,
    needsCaptions: false,
    message: "영상 전체 내용으로 퀴즈를 시작할 수 있습니다.",
  });
});

test("translation failure does not block a quiz when source captions are complete", () => {
  const completeSource = {
    ...pending,
    phase: "failed" as const,
    sourceSegments: [
      { start: 0, end: 5, text: "opening" },
      { start: 25, end: 30, text: "first idea" },
      { start: 55, end: 60, text: "middle" },
      { start: 85, end: 90, text: "application" },
      { start: 115, end: 120, text: "ending" },
    ],
  };

  assert.deepEqual(quizPreparation(completeSource, 120), {
    ready: true,
    needsCaptions: false,
    message: "영상 전체 내용으로 퀴즈를 시작할 수 있습니다.",
  });
});

test("a long video still needs captions near its ending", () => {
  const missingEnding = {
    ...pending,
    phase: "complete" as const,
    sourceSegments: [
      { start: 0, end: 5, text: "opening" },
      { start: 200, end: 205, text: "first idea" },
      { start: 450, end: 455, text: "middle" },
      { start: 700, end: 705, text: "application" },
      { start: 945, end: 950, text: "too early" },
    ],
  };

  assert.deepEqual(quizPreparation(missingEnding, 1_000), {
    ready: false,
    needsCaptions: false,
    message: "영상 전체 자막을 확인할 수 없어 퀴즈를 만들지 않았어요.",
  });
});

test("quiz preparation asks for captions only when no source sentence exists", () => {
  assert.deepEqual(
    quizPreparation({ ...pending, sourceSegments: [] }, 20),
    {
      ready: false,
      needsCaptions: true,
      message: "학습 자막을 먼저 준비해주세요.",
    },
  );
});

test("detects a missing opening range without retrying complete coverage", () => {
  assert.equal(
    needsInitialCaptionRepair({
      ...pending,
      phase: "index_pending",
      sourceSegments: [{ start: 388, end: 393, text: "late" }],
    }),
    true,
  );
  assert.equal(
    needsInitialCaptionRepair({
      ...pending,
      phase: "complete",
      sourceSegments: [{ start: 0, end: 5, text: "opening" }],
    }),
    false,
  );
});

test("uses learner-facing caption progress copy", () => {
  assert.equal(
    captionPhaseMessage({
      ...pending,
      phase: "source_pending",
      sourceSegments: [],
    }),
    "자막을 확인하고 있어요.",
  );
  assert.equal(
    captionPhaseMessage({
      ...pending,
      phase: "index_pending",
    }),
    "자막을 학습에 연결하고 있어요.",
  );
  assert.equal(
    captionPhaseMessage({
      ...pending,
      phase: "failed",
      errorCode: "CAPTION_PROVIDER_UNAVAILABLE",
    }),
    "학습 자막을 자동으로 만들지 못했어요.",
  );
});

test("does not retry videos that have no provided captions", () => {
  assert.equal(canRetryCaptions("CAPTION_PROVIDER_UNAVAILABLE"), false);
  assert.equal(canRetryCaptions("STT_DISABLED"), false);
  assert.equal(canRetryCaptions("TRANSLATION_PROVIDER_UNAVAILABLE"), true);
});

test("shows a Korean message when caption translation is unavailable", () => {
  assert.equal(
    captionPhaseMessage({
      ...pending,
      phase: "failed",
      errorCode: "TRANSLATION_PROVIDER_UNAVAILABLE",
    }),
    "한국어로 옮기지 못했어요.",
  );
});
