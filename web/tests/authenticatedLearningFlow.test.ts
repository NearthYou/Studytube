import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(
  resolve(testDirectory, "../src/App.tsx"),
  "utf8",
);
const learningPagePath = resolve(
  testDirectory,
  "../src/features/learning/LearningPage.tsx",
);

test("home and watch learning routes stay behind authentication", () => {
  assert.match(
    appSource,
    /path="\/"[\s\S]*?<ProtectedRoute[\s\S]*?<LearningPage/,
  );
  assert.match(
    appSource,
    /path="\/watch"[\s\S]*?<ProtectedRoute[\s\S]*?<LearningWorkspace/,
  );
});

test("learning home starts with URL registration and has an honest empty state", () => {
  assert.equal(existsSync(learningPagePath), true);
  const source = readFileSync(learningPagePath, "utf8");

  assert.match(source, /YouTube 영상 주소/);
  assert.match(source, /학습 시작/);
  assert.match(source, /아직 학습한 영상이 없습니다/);
  assert.match(source, /새 영상 등록/);
  assert.doesNotMatch(source, />[^\n<]*(?:Agent|MCP|RAG|AI)[^\n<]*</);
});

test("learning intake runs only from the authenticated page submit action", () => {
  const source = readFileSync(learningPagePath, "utf8");

  assert.match(source, /startLearningIntake/);
  assert.match(source, /onSubmit=\{handleSubmit\}/);
  assert.doesNotMatch(appSource, /<LearningPage[^>]*session=\{null/);
});

test("new learning intake keeps the public video title and introduction", () => {
  const source = readFileSync(learningPagePath, "utf8");

  assert.match(source, /askMcp\(\{ url: normalizedUrl, limit: 1 \}\)/);
  assert.match(source, /metadata\?\.title/);
  assert.match(source, /summary:/);
});

test("legacy recent videos pass cost admission before the new workspace opens", () => {
  const source = readFileSync(learningPagePath, "utf8");

  assert.match(source, /if \(!video\.learningContextId\)/);
  assert.match(source, /await startLearningIntake/);
});

test("login return state preserves the selected video query", () => {
  assert.match(
    appSource,
    /from:\s*location\.pathname\s*\+\s*location\.search\s*\+\s*location\.hash/,
  );
});
