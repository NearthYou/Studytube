import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const source = (path: string) =>
  readFileSync(resolve(directory, "../src", path), "utf8");

test("login landing shows the product before asking for Google login", () => {
  const auth = source("features/auth/AuthPage.tsx");

  assert.match(auth, /auth-product-preview/);
  assert.doesNotMatch(auth, /영상으로 배우기/);
});

test("onboarding keeps preference setup and one skip action", () => {
  const tutorial = source("features/onboarding/TutorialPage.tsx");

  assert.match(tutorial, /건너뛰기/);
  assert.doesNotMatch(
    tutorial,
    /tutorialPreviewItems|tutorialHighlights|tutorial-flow|tutorial-note/,
  );
});

test("home and empty workspace share the same direct video intake", () => {
  const intakePath = resolve(
    directory,
    "../src/features/learning/LearningIntakeForm.tsx",
  );

  assert.equal(existsSync(intakePath), true);
  if (!existsSync(intakePath)) return;

  const learningHome = source("features/learning/LearningPage.tsx");
  const learningWorkspace = source("features/learning/LearningWorkspace.tsx");

  assert.match(learningHome, /<LearningIntakeForm/);
  assert.match(learningWorkspace, /<LearningIntakeForm/);
  assert.doesNotMatch(learningWorkspace, /첫 영상 등록하기/);
});

test("empty workspace keeps the queued video metadata after registration", () => {
  const learningWorkspace = source("features/learning/LearningWorkspace.tsx");

  assert.match(learningWorkspace, /const \[queue, setQueue\] = useState/);
  assert.match(
    learningWorkspace,
    /<EmptyWorkspace[\s\S]*onQueued=\{setQueue\}/,
  );
});

test("video intake blocks a second submit before React rerenders", () => {
  const intake = source("features/learning/LearningIntakeForm.tsx");

  assert.match(intake, /const submittingRef = useRef\(false\)/);
  assert.match(intake, /if \(submittingRef\.current\) return/);
});

test("first-time home does not repeat a recent-learning empty card", () => {
  const learningHome = source("features/learning/LearningPage.tsx");

  assert.match(learningHome, /learning-first-guide/);
  assert.doesNotMatch(learningHome, /아직 학습한 영상이 없습니다/);
});
