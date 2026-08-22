import assert from "node:assert/strict";
import test from "node:test";
import {
  captionPairAt,
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

test("keeps quiz unavailable until caption evidence is indexed", () => {
  assert.deepEqual(quizPreparation(pending), {
    ready: false,
    message: "문제 근거를 준비하고 있습니다.",
  });
  assert.deepEqual(quizPreparation({ ...pending, phase: "complete" }), {
    ready: true,
    message: "퀴즈를 시작할 수 있습니다.",
  });
});

test("shows a Korean message when caption translation is unavailable", () => {
  assert.equal(
    captionPhaseMessage({
      ...pending,
      phase: "failed",
      errorCode: "TRANSLATION_PROVIDER_UNAVAILABLE",
    }),
    "한국어 자막을 만들지 못했습니다.",
  );
});
