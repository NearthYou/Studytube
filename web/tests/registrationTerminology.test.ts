import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = (fileName: string) => resolve(directory, "../src", fileName);
const draftSource = readFileSync(sourcePath("playlistDrafts.ts"), "utf8");
const activeCopy = [
  "features/learning/LearningPage.tsx",
  "features/learning/LearningWorkspace.tsx",
  "features/course/CoursePage.tsx",
  "features/onboarding/TutorialPage.tsx",
  "features/account/MyEditPage.tsx",
  "features/auth/AuthPage.tsx",
  "features/auth/VerificationPage.tsx",
  "features/auth/RegistrationCompletionPage.tsx",
].map((path) => readFileSync(sourcePath(path), "utf8")).join("\n");

test("default registration draft title is a playlist title", () => {
  assert.match(draftSource, /나만의 학습 플레이리스트/);
  assert.doesNotMatch(draftSource, /나만의 학습 코스/);
  assert.doesNotMatch(draftSource, /초안/);
});

test("visible active copy avoids retired draft terminology", () => {
  assert.doesNotMatch(activeCopy, /초안/);
  assert.doesNotMatch(activeCopy, /게시글 작성|게시글로 공개하기/);
});

test("active playlist copy does not fall back to public social wording", () => {
  assert.doesNotMatch(activeCopy, /공개 플레이리스트[^\n"]*코스/);
});

test("active copy hides implementation terms and translated account labels", () => {
  assert.doesNotMatch(activeCopy, />[^\n<]*(?:AI|Agent|MCP|RAG)[^\n<]*</);
  assert.doesNotMatch(activeCopy, /StudyTube Account/);
});
