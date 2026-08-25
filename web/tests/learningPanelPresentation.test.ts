import assert from "node:assert/strict";
import test from "node:test";
import {
  captionlessPanelPresentation,
  quizPanelPresentation,
} from "../src/features/learning/learningPanelPresentation.ts";

test("a provider failure offers one clear way to create learning captions", () => {
  assert.deepEqual(
    captionlessPanelPresentation({
      contextReady: true,
      liveActive: false,
      phase: "failed",
      retrying: false,
      retryable: false,
    }),
    {
      title: "학습 자막이 필요해요",
      description:
        "영상은 바로 볼 수 있어요. 문장 저장과 퀴즈를 쓰려면 학습 자막을 만들어 주세요.",
      action: "capture",
      actionLabel: "학습 자막 만들기",
      actionDisabled: false,
    },
  );
});

test("automatic caption preparation does not compete with another action", () => {
  assert.deepEqual(
    captionlessPanelPresentation({
      contextReady: true,
      liveActive: false,
      phase: "translation_pending",
      retrying: false,
      retryable: true,
    }),
    {
      title: "학습 자막을 준비하고 있어요",
      description: "준비된 문장부터 이곳에 바로 보여드릴게요.",
      action: null,
      actionLabel: "",
      actionDisabled: false,
    },
  );
});

test("quiz preparation uses one compact message and at most one action", () => {
  assert.deepEqual(
    quizPanelPresentation({
      evidenceReady: false,
      loopId: "",
      message: "퀴즈를 준비하고 있어요.",
      phase: "request",
    }),
    {
      title: "퀴즈를 만들려면 학습 자막이 필요해요",
      description:
        "학습 자막이 준비된 뒤 이 탭을 열면 지금까지 본 내용으로 퀴즈를 자동으로 만들어요.",
      actionLabel: "학습 자막 준비하기",
    },
  );

  assert.deepEqual(
    quizPanelPresentation({
      evidenceReady: true,
      loopId: "",
      message: "지금까지 본 구간으로 퀴즈를 만들 수 있습니다.",
      phase: "request",
    }),
    {
      title: "지금까지 본 내용으로 퀴즈를 만들고 있어요",
      description: "준비되면 이 화면에 바로 보여드릴게요.",
      actionLabel: "",
    },
  );
});
