import assert from "node:assert/strict";
import test from "node:test";
import {
  quizControls,
  quizPollingTimedOut,
  quizStateFromApi,
  shouldAutoRequestQuiz,
  transitionQuizState,
} from "../src/features/learning/adaptiveQuizFlow.ts";

test("quiz polling timeout stops the endless generating state", () => {
  const generating = quizStateFromApi(
    { id: "loop-1", state: "generating", questions: [] },
    true,
  );
  const timedOut = quizPollingTimedOut(generating);

  assert.equal(timedOut.phase, "failed");
  assert.equal(quizControls(timedOut).retry, true);
  assert.equal(
    timedOut.message,
    "퀴즈 준비가 오래 걸리고 있어요. 다시 만들어주세요.",
  );
  assert.equal(
    transitionQuizState(timedOut, { type: "requested" }).phase,
    "generating",
  );
});

test("quiz UI follows the bounded request to evaluated state contract", () => {
  let state = quizStateFromApi(null, true);
  assert.equal(state.phase, "request");
  assert.deepEqual(quizControls(state), {
    request: true,
    answer: false,
    submit: false,
    retry: false,
    regenerate: false,
  });
  state = transitionQuizState(state, { type: "requested" });
  assert.equal(state.phase, "generating");
  assert.equal(quizControls(state).request, false);
  state = quizStateFromApi(
    { id: "loop-1", state: "ready", questions: [{ id: "q1" }] },
    true,
  );
  assert.equal(state.phase, "ready");
  state = transitionQuizState(state, { type: "answer_changed" });
  assert.equal(state.phase, "answering");
  state = transitionQuizState(state, { type: "submit_started" });
  assert.equal(state.phase, "submitting");
  state = transitionQuizState(state, {
    type: "submit_succeeded",
    result: { score: 80 },
  });
  assert.equal(state.phase, "evaluated");
  assert.equal(quizControls(state).submit, false);
});

test("quiz submit failure returns to the answers with a visible message", () => {
  let state = quizStateFromApi(
    { id: "loop-1", state: "ready", questions: [{ id: "q1" }] },
    true,
  );
  state = transitionQuizState(state, { type: "answer_changed" });
  state = transitionQuizState(state, { type: "submit_started" });

  state = transitionQuizState(state, {
    type: "submit_failed",
    message: "답을 확인하지 못했어요. 선택한 답은 그대로 두었으니 다시 시도해 주세요.",
  });

  assert.equal(state.phase, "answering");
  assert.equal(
    state.message,
    "답을 확인하지 못했어요. 선택한 답은 그대로 두었으니 다시 시도해 주세요.",
  );
  assert.equal(quizControls(state).submit, true);
});

test("failed allows retry while stale only allows a new quiz", () => {
  const failed = quizStateFromApi(
    { id: "loop-1", state: "failed", questions: [] },
    true,
  );
  assert.equal(failed.phase, "failed");
  assert.equal(quizControls(failed).retry, true);
  const stale = quizStateFromApi(
    { id: "loop-1", state: "stale", questions: [] },
    true,
  );
  assert.equal(stale.phase, "stale");
  assert.deepEqual(quizControls(stale), {
    request: false,
    answer: false,
    submit: false,
    retry: false,
    regenerate: true,
  });
});

test("quiz stays blocked until caption evidence is ready", () => {
  const state = quizStateFromApi(null, false);
  assert.equal(state.phase, "request");
  assert.equal(quizControls(state).request, false);
  assert.equal(state.message, "퀴즈를 준비하고 있어요.");
});

test("opening the quiz tab requests one quiz as soon as captions are ready", () => {
  assert.equal(
    shouldAutoRequestQuiz({
      active: true,
      contextId: "context-1",
      evidenceReady: true,
      hasLoop: false,
      phase: "request",
      requestedContextId: "",
    }),
    true,
  );
  assert.equal(
    shouldAutoRequestQuiz({
      active: false,
      contextId: "context-1",
      evidenceReady: true,
      hasLoop: false,
      phase: "request",
      requestedContextId: "",
    }),
    false,
  );
  assert.equal(
    shouldAutoRequestQuiz({
      active: true,
      contextId: "context-1",
      evidenceReady: true,
      hasLoop: false,
      phase: "request",
      requestedContextId: "context-1",
    }),
    false,
  );
});
