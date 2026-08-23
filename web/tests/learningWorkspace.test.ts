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

test("learning workspace keeps the player and study tools in one desktop desk", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const player = source.indexOf("<LearningVideoPlayer");
  const desk = source.indexOf('className="learning-desk"');
  const tools = source.indexOf('className="learning-tools"');

  assert.ok(player >= 0);
  assert.ok(desk >= 0);
  assert.ok(tools > player);
  assert.match(source, /원문/);
  assert.match(source, /한국어/);
  assert.match(source, /label: "전체 자막"/);
  assert.match(source, /label: "핵심 내용"/);
  assert.match(source, /label: "메모"/);
  assert.match(source, /label: "퀴즈"/);
});

test("learning workspace shows useful video context without technical labels", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  assert.match(source, /function LearningSummaryPanel/);
  assert.match(source, /핵심 내용/);
  assert.match(source, /video\.summary/);
  assert.doesNotMatch(source, /AI 요약|자막 근거|문제 근거/);
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
  assert.match(stateSource, /퀴즈를 준비하고 있어요/);
  assert.match(source, /const MAX_CAPTION_POLLS = 170/);
  assert.match(source, /startLearningIntake/);
  assert.match(source, /자막 다시 만들기/);
  assert.match(source, /영상 설명과 공개 정보로 학습을 계속할 수 있습니다/);
  assert.doesNotMatch(source, /자막이 있는 다른 영상 선택/);
  assert.match(source, /canRetryCaptions/);
  assert.doesNotMatch(source, /Agent|MCP|RAG|AI/);
  assert.doesNotMatch(
    `${source}\n${stateSource}`,
    /자막 근거|문제 근거|음성 자막 기능|원문 자막 확인 중/,
  );
});

test("native YouTube captions stay visible until prepared captions arrive", () => {
  const workspaceSource = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const playerSource = readFileSync(
    resolve(featureDirectory, "LearningVideoPlayer.tsx"),
    "utf8",
  );

  assert.match(workspaceSource, /preferNativeCaptions=/);
  assert.match(workspaceSource, /caption=\{currentCaption\}/);
  assert.match(playerSource, /preferNativeCaptions: boolean/);
  assert.match(playerSource, /className="learning-player-caption"/);
  assert.match(
    playerSource,
    /cc_load_policy: preferNativeCaptionsRef\.current \? 1 : 0/,
  );
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

test("starting a note pins the current playback position automatically", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  assert.match(source, /function startNoteDraft/);
  assert.match(source, /notePositionSeconds: state\.currentTime/);
  assert.match(source, /selectedTab: "notes"/);
  assert.match(source, /noteInputRef\.current\?\.focus\(\)/);
  assert.match(source, />\s*메모하기\s*</);
  assert.doesNotMatch(source, /현재 위치로 바꾸기/);
  assert.doesNotMatch(source, /positionSeconds: state\.currentTime/);
});

test("learning workspace collapses safely at phone width", () => {
  const css = readFileSync(resolve(testDirectory, "../src/App.css"), "utf8");

  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /\.learning-desk\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.learning-tools\s*\{[\s\S]*overflow:/);
  assert.match(
    css,
    /\.learning-intake-form > div[\s\S]*grid-template-columns: 1fr/,
  );
  assert.match(css, /\.current-caption > div[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.learning-tablist button[\s\S]*min-width: 0/);
});
