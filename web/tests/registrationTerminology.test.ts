import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("web/src/App.tsx", "utf8");
const boardPageSource = appSource.slice(
  appSource.indexOf("function BoardPage"),
  appSource.indexOf("function CoursePage"),
);
const draftSource = readFileSync("web/src/playlistDrafts.ts", "utf8");

test("registration screen uses playlist terminology instead of course terminology", () => {
  assert.match(boardPageSource, /작성 중인 플레이리스트/);
  assert.match(boardPageSource, /플레이리스트 구성/);
  assert.match(boardPageSource, /플레이리스트 공개하기/);
  assert.doesNotMatch(boardPageSource, /코스|초안/);
});

test("default registration draft title is a playlist title", () => {
  assert.match(draftSource, /나만의 학습 플레이리스트/);
  assert.doesNotMatch(draftSource, /나만의 학습 코스|초안/);
});

test("visible app copy avoids draft terminology", () => {
  assert.doesNotMatch(appSource, /초안|작업 초안|플레이리스트 초안/);
});

test("public playlist copy does not fall back to course wording", () => {
  assert.doesNotMatch(appSource, /공개 플레이리스트[^\n"]*코스|첫 코스/);
});
