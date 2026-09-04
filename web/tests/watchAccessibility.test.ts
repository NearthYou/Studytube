import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(directory, "../src", path), "utf8");
const playerSource = source("features/learning/LearningVideoPlayer.tsx");
const playerOptionsSource = source("features/learning/youtubePlayerOptions.ts");
const workspaceSource = source("features/learning/LearningWorkspace.tsx");
const authSource = source("features/auth/AuthPage.tsx");

test("learning player owns loading and failure fallbacks", () => {
  assert.match(playerSource, /loadYoutubeApi/);
  assert.match(playerSource, /플레이어 준비 시간이 초과되었습니다/);
  assert.match(playerSource, /learning-player-error/);
});

test("empty learning state guides the first registration", () => {
  assert.match(workspaceSource, /보고 싶은 영상을 넣어보세요/);
  assert.match(workspaceSource, /<LearningIntakeForm/);
  assert.match(workspaceSource, /주제로 영상 찾기/);
});

test("prepared captions render over the video without blocking controls", () => {
  assert.match(playerSource, /learning-player-caption/);
  assert.match(playerOptionsSource, /cc_load_policy/);
  assert.match(workspaceSource, /caption=\{currentCaption\}/);
});

test("new learning workspace exposes keyboard tabs and polite status", () => {
  assert.equal(existsSync(resolve(directory, "../src/features/learning/LearningWorkspace.tsx")), true);
  assert.match(workspaceSource, /role="tablist"/);
  assert.match(workspaceSource, /role="tabpanel"/);
  assert.match(workspaceSource, /aria-live="polite"/);
  assert.match(workspaceSource, /onKeyDown=\{handleTabKeyDown\}/);
});

test("login page does not expose demo account shortcuts", () => {
  assert.doesNotMatch(authSource, /demoSession|demo-login-button|demo@studytube\.local|demo1234|데모 계정/);
});
