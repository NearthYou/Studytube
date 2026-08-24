import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");
const coursePath = resolve(root, "features/course/CoursePage.tsx");

test("the active Course screen owns its feature module", () => {
  assert.equal(existsSync(coursePath), true);
  if (!existsSync(coursePath)) return;
  const courseSource = readFileSync(coursePath, "utf8");
  assert.match(courseSource, /export function CoursePage/);
  assert.match(courseSource, /generatedCourseIdempotencyKey/);
  assert.doesNotMatch(appSource, /function CoursePage/);
});

test("course creation has one clear primary action and visible progress", () => {
  const source = readFileSync(coursePath, "utf8");
  assert.match(source, /코스 만들기/);
  assert.match(source, /aria-busy=\{isGenerating\}/);
  assert.match(source, /내 코스/);
  assert.doesNotMatch(source, /기존 코스 먼저 찾기|새로 만들어줘/);
});

test("saved course continuation appears before optional course discovery", () => {
  const source = readFileSync(coursePath, "utf8");
  const continuation = source.indexOf("이어갈 코스");
  const builder = source.indexOf('className="course-builder"');

  assert.ok(continuation >= 0);
  assert.ok(builder > continuation);
  assert.match(source, /<summary>새 코스 찾기<\/summary>/);
});
