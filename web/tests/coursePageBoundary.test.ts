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
const recommendationCardPath = resolve(
  root,
  "features/course/RecommendationVideoResult.tsx",
);
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
  assert.doesNotMatch(source, /배우고 싶은 내용을 입력해주세요/);
  assert.equal(
    source.match(/배울 내용을 적으면 맞는 영상을 골라/g)?.length,
    1,
  );
});

test("a quick recommendation starts generation with the selected text", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /async function generateNewCourse\(requestedSubject/);
  assert.match(source, /requestedSubject \?\? query/);
  assert.match(
    source,
    /onClick=\{\(\) => \{[\s\S]*?setQuery\(prompt\);[\s\S]*?generateNewCourse\(prompt\)/,
  );
  assert.match(
    source,
    /quick-prompts[\s\S]*?disabled=\{isGenerating\}/,
  );
});

test("Course builder contains creation without the saved Course library", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /className="course-builder"/);
  assert.doesNotMatch(source, /id="my-course-title">저장한 코스/);
  assert.doesNotMatch(source, /<details className="course-builder">/);
  assert.doesNotMatch(source, /이번 코스에 적용되는 학습 설정/);
  assert.doesNotMatch(source, /학습 속도 \{profile\.pace\}|목표 \{profile\.goal\}/);
  assert.match(source, /learningPreferenceSummary/);
  assert.match(source, /className="course-preference-note"/);
  assert.match(source, /추천 바꾸기/);
  assert.match(source, /to="\/me\/preferences"/);
  assert.match(source, /readLearningHistory/);
  assert.match(source, /createCourseRecommendationContext/);
  assert.match(source, /askAgent\([\s\S]*recommendationContext/);
  assert.match(
    source,
    /자막이 있고 아직 보지 않은 영상을 먼저 고릅니다\. 조회수는 비슷한 영상끼리 비교할 때만 봐요\./,
  );
  assert.doesNotMatch(source, /learningHistoryProgress/);
  assert.doesNotMatch(source, /이어갈 코스|준비된 학습 순서/);
  assert.match(source, /저장 전 코스/);
  assert.doesNotMatch(
    source,
    /findMatchingCourses|courseMatches|fetchPosts|postsFromCourse/,
  );
});

test("a single recommendation is never presented or saved as a course", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /canFormCourse\(generatedVideos\)/);
  assert.match(source, /맞는 영상 한 개를 찾았어요/);
  assert.match(source, /관련 없는 영상을 채우지 않았어요/);
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

test("prepared Course actions fit side by side at phone width", () => {
  const css = readFileSync(courseCssPath, "utf8");

  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*?\.playlist-toolbar \.prepared-course-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
  );
});

test("course recommendations survive reloads before the user saves a course", () => {
  const source = readFileSync(coursePath, "utf8");

  assert.match(source, /readCourseRecommendation/);
  assert.match(source, /saveCourseRecommendation/);
  assert.match(source, /clearCourseRecommendation/);
});

test("a new Course search removes the previous prepared result first", () => {
  const source = readFileSync(coursePath, "utf8");
  const generationStart = source.indexOf("setIsGenerating(true)");
  const clearStored = source.indexOf("clearCourseRecommendation()", generationStart);
  const clearVisible = source.indexOf("setRecommendation(null)", generationStart);
  const clearSavedMatches = source.indexOf("setRagResult(null)", generationStart);
  const requestStart = source.indexOf("Promise.allSettled", generationStart);

  assert.ok(generationStart >= 0);
  assert.ok(clearStored > generationStart && clearStored < requestStart);
  assert.ok(clearVisible > generationStart && clearVisible < requestStart);
  assert.ok(clearSavedMatches > generationStart && clearSavedMatches < requestStart);
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
  assert.match(source, /archiveCourse/);
  assert.match(source, /className="course-delete-trigger"/);
  assert.match(source, /삭제 확인/);
  assert.match(source, /disabled=\{deletingCourseId !== null\}/);
  assert.match(source, /role="status"/);
  assert.match(source, /libraryTitleRef\.current\?\.focus\(\)/);
  assert.match(source, /\$\{course\.title\} 삭제 확인/);
  assert.match(css, /\.course-library-grid\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.course-card-open\s*\{[^}]*padding:\s*18px/);
  assert.match(css, /\.course-card-actions\s*\{[^}]*justify-content:\s*flex-end/);
  assert.match(css, /\.course-video-preview img\s*\{[^}]*width:\s*72px/);
});

test("the new Course button keeps readable text on its accent background", () => {
  const css = readFileSync(courseCssPath, "utf8");

  assert.match(
    css,
    /\.course-library-heading \.primary-link\s*\{[^}]*color:\s*#07101f/,
  );
});

test("generated Course cards show learner-facing recommendation reasons", () => {
  assert.equal(existsSync(recommendationCardPath), true);
  if (!existsSync(recommendationCardPath)) return;
  const page = readFileSync(coursePath, "utf8");
  const source = readFileSync(recommendationCardPath, "utf8");
  const css = readFileSync(courseCssPath, "utf8");

  assert.match(page, /RecommendationVideoResult/);
  assert.match(source, /recommendationPresentation/);
  assert.match(source, /className="course-recommendation-reasons"/);
  assert.match(source, /presentation\.stepLabel/);
  assert.match(source, /presentation\.reasonText/);
  assert.doesNotMatch(source, /recommendationScore/);
  assert.match(
    css,
    /\.course-recommendation-reasons\s*\{[^}]*color:\s*var\(--app-muted\)/,
  );
});
