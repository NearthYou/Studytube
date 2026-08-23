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
