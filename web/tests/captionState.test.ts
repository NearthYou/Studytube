import assert from "node:assert/strict";
import test from "node:test";
import {
  captionPairAt,
  canRetryCaptions,
  captionPhaseMessage,
  mergeCaptionState,
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

test("opens a quiz after five watched caption sentences even while indexing", () => {
  assert.deepEqual(quizPreparation(pending), {
    ready: false,
    message: "자막 문장 5개를 본 뒤 퀴즈가 열려요.",
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
  assert.deepEqual(quizPreparation(indexing, 35), {
    ready: false,
    message: "자막 문장 5개를 본 뒤 퀴즈가 열려요.",
  });
  assert.deepEqual(quizPreparation(indexing, 50), {
    ready: true,
    message: "퀴즈를 시작할 수 있습니다.",
  });
  assert.deepEqual(quizPreparation({ ...indexing, phase: "complete" }, 50), {
    ready: true,
    message: "퀴즈를 시작할 수 있습니다.",
  });
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
