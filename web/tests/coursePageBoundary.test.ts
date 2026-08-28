import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const appSource = readFileSync(resolve(root, "App.tsx"), "utf8");
const coursePath = resolve(root, "features/course/CoursePage.tsx");
const courseLibraryPath = resolve(root, "features/course/CourseLibraryPage.tsx");
const courseCssPath = resolve(root, "features/course/CoursePage.css");
const routesPath = resolve(root, "app/AppRoutes.tsx");

test("Course creation and saved Course browsing have separate routes", () => {
  assert.equal(existsSync(coursePath), true);
  assert.equal(existsSync(courseLibraryPath), true);
  if (!existsSync(coursePath)) return;
  const builder = readFileSync(coursePath, "utf8");
  const library = readFileSync(courseLibraryPath, "utf8");
  const routes = readFileSync(routesPath, "utf8");

  assert.match(builder, /export function CourseBuilderPage/);
  assert.match(builder, /generatedCourseIdempotencyKey/);
  assert.doesNotMatch(builder, /course-library-grid/);
  assert.match(library, /export function CourseLibraryPage/);
  assert.match(library, /course-library-grid/);
  assert.doesNotMatch(library, /className="course-builder"/);
  assert.match(routes, /path="\/courses"[\s\S]*CourseLibraryPage/);
  assert.match(routes, /path="\/courses\/new"[\s\S]*CourseBuilderPage/);
  assert.doesNotMatch(appSource, /function CoursePage/);
});

test("course creation has one clear primary action and visible progress", () => {
  const source = readFileSync(coursePath, "utf8");
  assert.match(source, /코스 만들기/);
  assert.match(source, /aria-busy=\{isGenerating\}/);
  assert.match(source, /저장 코스 보기/);
  assert.doesNotMatch(source, /기존 코스 먼저 찾기|새로 만들어줘/);
});

test("Course builder contains creation without the saved Course library", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /className="course-builder"/);
  assert.doesNotMatch(source, /id="my-course-title">저장한 코스/);
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

test("saved courses use searchable preview cards with a compact video list", () => {
  const source = readFileSync(courseLibraryPath, "utf8");
  const css = readFileSync(courseCssPath, "utf8");

  assert.match(source, /className="course-library-grid"/);
  assert.match(source, /className="course-library-card"/);
  assert.match(source, /course\.steps\.slice\(0, 3\)/);
  assert.match(source, /className="course-video-preview"/);
  assert.match(source, /step\.snapshot\.thumbnailUrl/);
  assert.match(source, /placeholder="코스나 영상 검색"/);
  assert.match(source, /2~3개/);
  assert.match(source, /4개 이상/);
  assert.match(source, /최근 저장순/);
  assert.match(css, /\.course-library-grid\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.course-library-card\s*\{[^}]*padding:\s*18px/);
  assert.match(css, /\.course-video-preview img\s*\{[^}]*width:\s*72px/);
});
