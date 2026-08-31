import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");
const routesSource = readFileSync(resolve(root, "app/AppRoutes.tsx"), "utf8");

test("authentication screens own their feature modules", () => {
  for (const file of ["AuthPage.tsx", "GoogleAuthCompletePage.tsx"]) {
    assert.equal(existsSync(resolve(root, "features/auth", file)), true);
  }
  for (const file of [
    "VerificationPage.tsx",
    "RegistrationCompletionPage.tsx",
  ]) {
    assert.equal(existsSync(resolve(root, "features/auth", file)), false);
  }
  assert.match(routesSource, /from "\.\.\/features\/auth\/AuthPage"/);
  assert.match(
    routesSource,
    /from "\.\.\/features\/auth\/GoogleAuthCompletePage"/,
  );
  assert.doesNotMatch(appSource, /function (AuthPage|GoogleAuthCompletePage)/);
});
