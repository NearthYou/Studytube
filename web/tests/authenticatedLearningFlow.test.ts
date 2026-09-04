import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(
  resolve(testDirectory, "../src/app/AppRoutes.tsx"),
  "utf8",
);
const protectedRouteSource = readFileSync(
  resolve(testDirectory, "../src/app/ProtectedRoute.tsx"),
  "utf8",
);
const learningPagePath = resolve(
  testDirectory,
  "../src/features/learning/LearningPage.tsx",
);
const learningIntakePath = resolve(
  testDirectory,
  "../src/features/learning/LearningIntakeForm.tsx",
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
  assert.equal(existsSync(learningIntakePath), true);
  const source = readFileSync(learningPagePath, "utf8");
  const intake = readFileSync(learningIntakePath, "utf8");

  assert.match(intake, /YouTube 영상 주소/);
  assert.match(intake, /영상 열기/);
  assert.match(source, /learning-first-guide/);
  assert.doesNotMatch(source, /아직 학습한 영상이 없습니다/);
  assert.doesNotMatch(
    `${source}\n${intake}`,
    />[^\n<]*(?:Agent|MCP|RAG|AI)[^\n<]*</,
  );
});

test("learning intake runs only from the authenticated page submit action", () => {
  const source = readFileSync(learningIntakePath, "utf8");

  assert.match(source, /startLearningIntake/);
  assert.match(source, /onSubmit=\{handleSubmit\}/);
  assert.doesNotMatch(appSource, /<LearningPage[^>]*session=\{null/);
});

test("new learning intake keeps the public video title and introduction", () => {
  const source = readFileSync(learningIntakePath, "utf8");

  assert.match(source, /askMcp\(\{ url: normalizedUrl, limit: 1 \}\)/);
  assert.match(source, /metadata\?\.title/);
  assert.match(source, /summary:/);
  assert.doesNotMatch(source, /`\$\{channelName\}의 \$\{title\} 영상입니다/);
});

test("learning home shows one clear continue card instead of a video grid", () => {
  const source = readFileSync(learningPagePath, "utf8");

  assert.match(source, /const recentVideo = recentVideos\[0\]/);
  assert.doesNotMatch(source, /recentVideos\.slice\(0, 6\)\.map/);
});

test("legacy recent videos pass cost admission before the new workspace opens", () => {
  const source = readFileSync(learningPagePath, "utf8");

  assert.match(source, /if \(!video\.learningContextId\)/);
  assert.match(source, /await startLearningIntake/);
});

test("login return state preserves the selected video query", () => {
  assert.match(
    protectedRouteSource,
    /from:\s*location\.pathname\s*\+\s*location\.search\s*\+\s*location\.hash/,
  );
});

test("navigation and authentication links keep a touchable target", () => {
  const theme = readFileSync(
    resolve(testDirectory, "../src/styles/theme.css"),
    "utf8",
  );

  assert.match(theme, /\.site-nav a,[\s\S]*\.auth-card a[\s\S]*min-height: 44px/);
});
