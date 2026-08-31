import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { googleLoginUrl } from "../src/api.ts";
import { googleAuthErrorMessage } from "../src/features/auth/googleAuthPresentation.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("Google login URL keeps only the safe in-app return path", () => {
  assert.equal(
    googleLoginUrl("/courses"),
    "http://localhost:3000/auth/google/start?returnTo=%2Fcourses",
  );
});

test("Google callback errors use short natural Korean copy", () => {
  assert.equal(
    googleAuthErrorMessage("cancelled"),
    "Google 로그인을 취소했어요.",
  );
  assert.equal(
    googleAuthErrorMessage("expired"),
    "로그인 시간이 지났어요. 다시 시작해 주세요.",
  );
  assert.equal(
    googleAuthErrorMessage("unavailable"),
    "지금은 로그인할 수 없어요. 잠시 후 다시 시도해 주세요.",
  );
  assert.equal(googleAuthErrorMessage("raw-provider-error"), "");
});

test("the public auth surface contains Google login only", () => {
  const authPage = readFileSync(
    resolve(root, "features/auth/AuthPage.tsx"),
    "utf8",
  );
  const completionPath = resolve(
    root,
    "features/auth/GoogleAuthCompletePage.tsx",
  );
  const routes = readFileSync(resolve(root, "app/AppRoutes.tsx"), "utf8");
  const navigation = readFileSync(resolve(root, "app/SiteNav.tsx"), "utf8");
  const documentShell = readFileSync(resolve(root, "../index.html"), "utf8");

  assert.match(authPage, /Google로 계속하기/);
  assert.doesNotMatch(
    authPage,
    /type="password"|type="email"|회원가입|인증번호/,
  );
  assert.equal(existsSync(completionPath), true);
  assert.equal(
    existsSync(resolve(root, "features/auth/VerificationPage.tsx")),
    false,
  );
  assert.equal(
    existsSync(resolve(root, "features/auth/RegistrationCompletionPage.tsx")),
    false,
  );
  assert.match(routes, /path="\/auth\/google\/complete"/);
  assert.doesNotMatch(
    routes,
    /path="\/signup|VerificationPage|RegistrationCompletionPage/,
  );
  assert.doesNotMatch(navigation, /회원가입|to="\/signup"/);
  assert.doesNotMatch(authPage, /className="eyebrow"/);
  assert.match(navigation, /location\.pathname !== "\/login"/);
  assert.match(documentShell, /<html lang="ko">/);
  assert.match(documentShell, /<title>StudyTube<\/title>/);
});

test("the Google login card keeps one compact full-width action", () => {
  const css = readFileSync(resolve(root, "App.css"), "utf8");

  assert.match(
    css,
    /\.auth-card h1\s*\{[^}]*font-size:\s*clamp\(28px,\s*5vw,\s*36px\)/,
  );
  assert.match(css, /\.google-login\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.auth-status\s*\{[^}]*color:\s*var\(--app-muted\)/);
});
