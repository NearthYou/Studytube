import assert from "node:assert/strict";
import test from "node:test";
import { quizPage } from "../src/features/learning/quizPresentation.ts";

const questions = [
  { id: "q1", prompt: "첫 번째 개념은?" },
  { id: "q2", prompt: "두 번째 개념은?" },
  { id: "q3", prompt: "세 번째 개념은?" },
];

test("quiz page exposes one question and learner progress", () => {
  assert.deepEqual(quizPage(questions, 1), {
    question: questions[1],
    position: 2,
    total: 3,
    isFirst: false,
    isLast: false,
  });
});

test("quiz page clamps stale navigation to the last question", () => {
  assert.deepEqual(quizPage(questions, 99), {
    question: questions[2],
    position: 3,
    total: 3,
    isFirst: false,
    isLast: true,
  });
});
