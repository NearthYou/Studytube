import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");
const routesSource = readFileSync(resolve(root, "app/AppRoutes.tsx"), "utf8");

test("authentication screens own their feature modules", () => {
  for (const file of [
    "AuthPage.tsx",
    "VerificationPage.tsx",
    "RegistrationCompletionPage.tsx",
  ]) {
    assert.equal(existsSync(resolve(root, "features/auth", file)), true);
  }
  assert.match(routesSource, /from "\.\.\/features\/auth\/AuthPage"/);
  assert.match(routesSource, /from "\.\.\/features\/auth\/VerificationPage"/);
  assert.match(
    routesSource,
    /from "\.\.\/features\/auth\/RegistrationCompletionPage"/,
  );
  assert.doesNotMatch(
    appSource,
    /function (AuthPage|VerificationPage|RegistrationCompletionPage)/,
  );
});
