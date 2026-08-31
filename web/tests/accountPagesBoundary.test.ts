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
    "features/account/LearningPreferencesPage.tsx",
    "features/account/LearningPreferenceFields.tsx",
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
  assert.doesNotMatch(source, /학습 설정|학습 속도|학습 취향/);
});

test("account screen explains recommendation settings and progress", () => {
  const source = readFileSync(
    resolve(root, "features/account/MyPage.tsx"),
    "utf8",
  );
  assert.match(source, /추천 기준/);
  assert.match(source, /추천 기준 수정/);
  assert.match(source, /to="\/me\/preferences"/);
  assert.match(source, /내 학습/);
  assert.match(source, /진행 중인 코스/);
  assert.match(source, /학습할 영상/);
  assert.match(source, /저장한 문장/);
  assert.match(
    source,
    /코스의 주제와 하루 학습량을 고를 때 반영합니다/,
  );
  assert.doesNotMatch(source, /보드 플레이리스트|등록 영상/);
});

test("recommendation settings have a direct password-free edit route", () => {
  const routes = readFileSync(resolve(root, "app/AppRoutes.tsx"), "utf8");
  const preferencesPath = resolve(
    root,
    "features/account/LearningPreferencesPage.tsx",
  );
  const fieldsPath = resolve(
    root,
    "features/account/LearningPreferenceFields.tsx",
  );
  assert.equal(existsSync(preferencesPath), true);
  assert.equal(existsSync(fieldsPath), true);
  if (!existsSync(preferencesPath) || !existsSync(fieldsPath)) return;
  const preferences = readFileSync(preferencesPath, "utf8");
  const fields = readFileSync(fieldsPath, "utf8");
  const accountEdit = readFileSync(
    resolve(root, "features/account/MyEditPage.tsx"),
    "utf8",
  );

  assert.match(routes, /path="\/me\/preferences"[\s\S]*LearningPreferencesPage/);
  assert.match(preferences, /updateMe\(\{\s*preferences,/);
  assert.match(preferences, /clearCourseRecommendation\(\)/);
  assert.match(preferences, /paceForPreferenceSave/);
  assert.doesNotMatch(preferences, /currentPassword|ProfileVerificationForm/);
  assert.match(fields, /배우고 싶은 분야/);
  assert.match(fields, /하루 학습 시간/);
  assert.match(fields, /원하는 학습 결과/);
  assert.doesNotMatch(accountEdit, /preference-section|draft\.interests|draft\.pace|draft\.goal/);
});

test("profile verification keeps readable dark surfaces and controls", () => {
  const css = readFileSync(resolve(root, "App.css"), "utf8");

  assert.match(
    css,
    /\.profile-page \.profile-verification-form\s*\{[^}]*background:\s*var\(--app-surface\)/,
  );
  assert.match(
    css,
    /\.profile-page \.profile-verification-form \.identity-section\s*\{[^}]*background:\s*var\(--app-elevated\)/,
  );
  assert.match(
    css,
    /\.profile-page \.profile-verification-form input\s*\{[^}]*color:\s*var\(--app-text\)/,
  );
});
