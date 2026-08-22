import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const featureDirectory = resolve(testDirectory, "../src/features/learning");

test("learning workspace is split into a focused feature boundary", () => {
  assert.equal(existsSync(resolve(featureDirectory, "LearningPage.tsx")), true);
  assert.equal(
    existsSync(resolve(featureDirectory, "LearningWorkspace.tsx")),
    true,
  );
  assert.equal(existsSync(resolve(featureDirectory, "captionState.ts")), true);
});

test("learning workspace keeps the player, bilingual current caption and tabs in order", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const player = source.indexOf("<LearningVideoPlayer");
  const caption = source.indexOf('className="current-caption"');
  const tabs = source.indexOf('role="tablist"');

  assert.ok(player >= 0);
  assert.ok(caption > player);
  assert.ok(tabs > caption);
  assert.match(source, /원문/);
  assert.match(source, /한국어/);
  assert.match(source, /label: "전체 자막"/);
  assert.match(source, /label: "메모"/);
  assert.match(source, /label: "퀴즈"/);
});

test("YouTube loading and playback lifecycle stay behind one player interface", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningVideoPlayer.tsx"),
    "utf8",
  );

  assert.match(source, /export type LearningVideoPlayerHandle/);
  assert.match(source, /seek: \(seconds: number\) => void/);
  assert.match(source, /youtubeApiPromise = null/);
  assert.match(source, /playerRef\.current\?\.destroy\(\)/);
  assert.match(source, /플레이어 스크립트를 불러오지 못했습니다/);
});

test("unfinished learning tools are presented as preparation states", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  const stateSource = readFileSync(
    resolve(featureDirectory, "captionState.ts"),
    "utf8",
  );
  assert.match(stateSource, /문제 근거를 준비하고 있습니다/);
  assert.match(source, /state\.captions\.phase !== "complete"/);
  assert.match(source, /상태 새로고침/);
  assert.doesNotMatch(source, /Agent|MCP|RAG|AI/);
});

test("quiz polling keeps one bounded abortable loop for each quiz identity", () => {
  const source = readFileSync(
    resolve(featureDirectory, "useAdaptiveQuiz.ts"),
    "utf8",
  );

  assert.match(source, /const MAX_QUIZ_POLLS = 10/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /fetchAdaptiveQuiz\(activeLoopId, \{ signal \}\)/);
  assert.match(source, /\[loopId, loopState\]/);
});

test("next proposal requests are single-flight and cancel polling on unmount", () => {
  const source = readFileSync(
    resolve(featureDirectory, "useNextLearningProposal.ts"),
    "utf8",
  );

  assert.match(source, /inFlight/);
  assert.match(source, /activeRequestRef/);
  assert.match(source, /waitForProposalRun\(run, signal\)/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /activeRequestRef\.current\?\.controller\.abort\(\)/);
});

test("learning workspace collapses safely at phone width", () => {
  const css = readFileSync(resolve(testDirectory, "../src/App.css"), "utf8");

  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(
    css,
    /\.learning-intake-form > div[\s\S]*grid-template-columns: 1fr/,
  );
  assert.match(css, /\.current-caption > div[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.learning-tablist button[\s\S]*min-width: 0/);
});
