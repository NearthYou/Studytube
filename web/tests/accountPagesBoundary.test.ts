import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");

test("onboarding and account screens own their feature modules", () => {
  for (const path of [
    "features/onboarding/TutorialPage.tsx",
    "features/account/MyPage.tsx",
    "features/account/MyEditPage.tsx",
    "features/account/ProfileVerificationForm.tsx",
  ]) {
    assert.equal(existsSync(resolve(root, path)), true);
  }
  assert.doesNotMatch(
    appSource,
    /function (TutorialPage|MyPage|MyEditPage|ProfileVerificationForm)/,
  );
});

test("active account and onboarding actions avoid retired routes", () => {
  const source = [
    "features/onboarding/TutorialPage.tsx",
    "features/account/MyPage.tsx",
  ]
    .map((path) => readFileSync(resolve(root, path), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /["']\/(?:board|search|me\/posts)["']/);
});

test("account screen makes learning preferences and progress its primary job", () => {
  const source = readFileSync(
    resolve(root, "features/account/MyPage.tsx"),
    "utf8",
  );
  assert.match(source, /학습 설정/);
  assert.match(source, /진행 중인 코스/);
  assert.match(source, /학습할 영상/);
  assert.doesNotMatch(source, /보드 플레이리스트|등록 영상/);
});
