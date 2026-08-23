import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");

test("App owns session composition only", () => {
  assert.ok(appSource.split(/\r?\n/).length <= 250);
  assert.doesNotMatch(
    appSource,
    /void (BoardPage|ExplorePage|MyPostsPage|HomePage|WatchPage)/,
  );
  assert.doesNotMatch(
    appSource,
    /function (BoardPage|ExplorePage|MyPostsPage|HomePage|WatchPage)/,
  );
});

test("application routing and navigation have focused modules", () => {
  for (const file of [
    "AppRoutes.tsx",
    "ProtectedRoute.tsx",
    "SiteNav.tsx",
    "GuardedLink.tsx",
  ]) {
    assert.equal(existsSync(resolve(root, "app", file)), true);
  }
});

test("retired social screens are deleted instead of moved", () => {
  const sourceFiles = [
    "features/board/BoardPage.tsx",
    "features/explore/ExplorePage.tsx",
    "features/account/MyPostsPage.tsx",
    "features/learning/WatchPage.tsx",
  ];
  for (const file of sourceFiles) assert.equal(existsSync(resolve(root, file)), false);
});
