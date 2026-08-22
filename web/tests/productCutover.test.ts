import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(resolve(directory, "../src/App.tsx"), "utf8");
const workspace = readFileSync(
  resolve(directory, "../src/features/learning/LearningWorkspace.tsx"),
  "utf8",
);

test("product navigation exposes learning, Course and account only", () => {
  const nav = app.slice(
    app.indexOf("function SiteNav"),
    app.indexOf("function GuardedLink"),
  );
  assert.match(nav, /to="\/watch">학습/);
  assert.match(nav, /to="\/courses">내 Course/);
  assert.match(nav, /to="\/me">내 정보/);
  assert.doesNotMatch(nav, /보드|등록|게시물|좋아요|댓글/);
});

test("retired social routes are not mounted as product routes", () => {
  const routes = app.slice(app.indexOf("<Routes>"), app.indexOf("</Routes>"));
  for (const route of ["/board", "/explore", "/playlists", "/me/posts"]) {
    assert.doesNotMatch(routes, new RegExp(`path=["']${route}`));
  }
  assert.match(routes, /path="\/courses"/);
  assert.match(routes, /path="\*"/);
});

test("an evaluated quiz can continue to a next-learning proposal", () => {
  assert.match(workspace, /NextLearningProposal/);
  assert.match(workspace, /다음 학습 제안 받기/);
  assert.doesNotMatch(workspace, /Agent|MCP|RAG/);
});
