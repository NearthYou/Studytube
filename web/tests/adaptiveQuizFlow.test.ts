import assert from "node:assert/strict";
import test from "node:test";
import {
  quizControls,
  quizStateFromApi,
  shouldAutoRequestQuiz,
  transitionQuizState,
} from "../src/features/learning/adaptiveQuizFlow.ts";

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
