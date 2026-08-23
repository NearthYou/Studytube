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
