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
  ]) {
    assert.equal(existsSync(resolve(root, path)), true);
  }
  assert.equal(
    existsSync(resolve(root, "features/account/ProfileVerificationForm.tsx")),
    false,
  );
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

test("account screen explains how Course recommendations change", () => {
  const source = readFileSync(
    resolve(root, "features/account/MyPage.tsx"),
    "utf8",
  );
  assert.match(source, /코스 추천/);
  assert.match(source, /추천 바꾸기/);
  assert.match(source, /to="\/me\/preferences"/);
  assert.match(source, /내 학습/);
  assert.match(source, /진행 중인 코스/);
  assert.match(source, /학습할 영상/);
  assert.match(source, /저장한 문장/);
  assert.match(
    source,
    /분야는 검색 주제에, 시간은 영상 길이에, 배우는 방식은 어떤\s+영상을 먼저 고를지 정할 때 써요/,
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

  assert.match(
    routes,
    /path="\/me\/preferences"[\s\S]*LearningPreferencesPage/,
  );
  assert.match(preferences, /updateMe\(\{\s*preferences,/);
  assert.match(preferences, /clearCourseRecommendation\(\)/);
  assert.match(preferences, /paceForPreferenceSave/);
  assert.doesNotMatch(preferences, /currentPassword|ProfileVerificationForm/);
  assert.match(fields, /배우고 싶은 분야/);
  assert.match(fields, /한 번에 볼 시간/);
  assert.match(fields, /type="number"/);
  assert.match(fields, /min=\{LEARNING_TIME_LIMITS\.min\}/);
  assert.match(fields, /max=\{LEARNING_TIME_LIMITS\.max\}/);
  assert.match(fields, /step=\{LEARNING_TIME_LIMITS\.step\}/);
  assert.match(fields, /required=\{!legacyTime\}/);
  assert.match(fields, /어떻게 배우고 싶나요/);
  assert.doesNotMatch(fields, /하루 학습 시간|원하는 학습 결과|학습 속도/);
  assert.doesNotMatch(
    accountEdit,
    /preference-section|draft\.interests|draft\.pace|draft\.goal/,
  );
});

test("account editing keeps only the required dark form", () => {
  const source = readFileSync(
    resolve(root, "features/account/MyEditPage.tsx"),
    "utf8",
  );
  const cssPath = resolve(root, "features/account/AccountEditPage.css");

  assert.equal(existsSync(cssPath), true);
  if (!existsSync(cssPath)) return;
  const css = readFileSync(cssPath, "utf8");

  assert.match(source, /account-edit-page/);
  assert.match(source, /AccountEditPage\.css/);
  assert.doesNotMatch(
    source,
    /profile-stats|관심사|확인됨|확인 유지|currentPassword|새 비밀번호|ProfileVerificationForm/,
  );
  const accountPage = readFileSync(
    resolve(root, "features/account/MyPage.tsx"),
    "utf8",
  );
  assert.match(accountPage, /to="\/me\/edit"/);
  assert.doesNotMatch(accountPage, /isVerifying|ProfileVerificationForm/);
  assert.match(
    css,
    /\.account-edit-form\s*\{[^}]*background:\s*var\(--app-surface\)/,
  );
  assert.match(
    css,
    /\.account-edit-fields\s*\{[^}]*background:\s*var\(--app-elevated\)/,
  );
});
