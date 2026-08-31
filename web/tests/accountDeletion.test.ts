import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { accountDeletionReauthUrl, deleteMe } from "../src/api.ts";
import { setUnauthorizedHandler } from "../src/api.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("account deletion uses Google reauthentication and an origin-checked DELETE", async () => {
  assert.equal(
    accountDeletionReauthUrl(),
    "http://localhost:3000/me/deletion/google/start",
  );
  const originalFetch = globalThis.fetch;
  let captured: { input: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    captured = { input: String(input), init };
    return new Response(null, { status: 204 });
  };

  try {
    await deleteMe();
    assert.match(captured?.input ?? "", /\/me$/);
    assert.equal(captured?.init?.method, "DELETE");
    assert.equal(captured?.init?.credentials, "include");
    assert.equal(
      new Headers(captured?.init?.headers).get("Content-Type"),
      "application/json",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("account deletion is one compact protected confirmation screen", () => {
  const pagePath = resolve(root, "features/account/AccountDeletionPage.tsx");
  assert.equal(existsSync(pagePath), true);
  if (!existsSync(pagePath)) return;
  const page = readFileSync(pagePath, "utf8");
  const routes = readFileSync(resolve(root, "app/AppRoutes.tsx"), "utf8");
  const account = readFileSync(
    resolve(root, "features/account/MyPage.tsx"),
    "utf8",
  );

  assert.match(page, /Google로 본인 확인/);
  assert.match(page, /계정과 학습 기록 삭제/);
  assert.match(page, /복구할 수 없어요/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /isDeleting/);
  assert.doesNotMatch(page, /OAuth|토큰|파이프라인|공급자|Agent|MCP|RAG/);
  assert.match(routes, /path="\/me\/delete"[\s\S]*AccountDeletionPage/);
  assert.match(account, /to="\/me\/delete"/);
});

test("expired deletion reauthentication keeps the session and explains the next action", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = 0;
  setUnauthorizedHandler(() => {
    unauthorized += 1;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "ACCOUNT_REAUTH_REQUIRED",
        message: "Recent Google authentication is required",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      deleteMe(),
      /본인 확인 시간이 지났어요. Google 계정으로 다시 확인해 주세요/,
    );
    assert.equal(unauthorized, 0);
  } finally {
    setUnauthorizedHandler(null);
    globalThis.fetch = originalFetch;
  }
});
