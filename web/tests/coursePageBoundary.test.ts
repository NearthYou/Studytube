import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");
const coursePath = resolve(root, "features/course/CoursePage.tsx");
const courseCssPath = resolve(root, "features/course/CoursePage.css");

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

test("Course screen contains creation and saved courses without the home feed", () => {
  const source = readFileSync(coursePath, "utf8");
  const builder = source.indexOf('className="course-builder"');
  const library = source.indexOf('id="my-course-title">저장한 코스');

  assert.ok(builder >= 0);
  assert.ok(library > builder);
  assert.doesNotMatch(source, /<details className="course-builder">/);
  assert.match(source, /이번 코스에 적용되는 학습 설정/);
  assert.match(source, /학습 설정 바꾸기/);
  assert.doesNotMatch(source, /readLearningHistory|learningHistoryProgress/);
  assert.doesNotMatch(source, /이어갈 코스|최근 학습|준비된 학습 순서/);
  assert.match(source, /저장 전 코스/);
  assert.match(source, /조회수 순이 아닙니다/);
  assert.doesNotMatch(
    source,
    /findMatchingCourses|courseMatches|fetchPosts|postsFromCourse/,
  );
});

test("a single recommendation is never presented or saved as a course", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /canFormCourse\(generatedVideos\)/);
  assert.match(source, /관련 영상 한 개를 찾았습니다/);
  assert.match(source, /코스로 묶으려면 영상이 두 개 이상 필요합니다/);
  assert.match(source, /saveCourse\(\s*generatedVideos,\s*generatedTitle/);
});

test("generated recommendations save through native Course snapshots", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /courseStepFromQueueVideo/);
  assert.doesNotMatch(source, /createPost|ensurePostIdsForGeneratedVideos/);
});

test("course builder heading stays subordinate to the page title", () => {
  const css = readFileSync(courseCssPath, "utf8");

  assert.match(
    css,
    /\.course-builder-heading h2\s*\{[^}]*font-size:\s*24px/,
  );
});

test("course recommendations survive reloads before the user saves a course", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /readCourseRecommendation/);
  assert.match(source, /saveCourseRecommendation/);
  assert.match(source, /clearCourseRecommendation/);
});

test("a prepared recommendation can be saved after the page reloads", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /savePreparedCourse/);
  assert.match(source, /코스로 저장/);
});

test("saved courses use preview cards with a compact video list", () => {
  const source = readFileSync(coursePath, "utf8");
  const css = readFileSync(courseCssPath, "utf8");

  assert.match(source, /className="course-library-grid"/);
  assert.match(source, /className="course-library-card"/);
  assert.match(source, /course\.steps\.slice\(0, 3\)/);
  assert.match(source, /className="course-video-preview"/);
  assert.match(source, /step\.snapshot\.thumbnailUrl/);
  assert.match(css, /\.course-library-grid\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.course-library-card\s*\{[^}]*padding:\s*18px/);
  assert.match(css, /\.course-video-preview img\s*\{[^}]*width:\s*72px/);
});
