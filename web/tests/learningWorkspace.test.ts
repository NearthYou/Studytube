import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const featureDirectory = resolve(testDirectory, "../src/features/learning");

test("learning workspace is split into a focused feature boundary", () => {
  assert.equal(existsSync(resolve(featureDirectory, "LearningPage.tsx")), true);
  assert.equal(
    existsSync(resolve(featureDirectory, "LearningWorkspace.tsx")),
    true,
  );
  assert.equal(existsSync(resolve(featureDirectory, "captionState.ts")), true);
  assert.equal(
    existsSync(resolve(featureDirectory, "CurrentSentencePanel.tsx")),
    true,
  );
  assert.equal(
    existsSync(resolve(featureDirectory, "LearningOverviewPanel.tsx")),
    true,
  );
  assert.equal(
    existsSync(resolve(featureDirectory, "TranscriptDrawer.tsx")),
    true,
  );
});

test("learning workspace keeps the player and study tools in one desktop desk", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const player = source.indexOf("<LearningVideoPlayer");
  const desk = source.indexOf('className="learning-desk"');
  const tools = source.indexOf('className="learning-tools"');

  assert.ok(player >= 0);
  assert.ok(desk >= 0);
  assert.ok(tools > player);
  assert.match(source, /label: "지금 문장"/);
  assert.match(source, /label: "내용 정리"/);
  assert.match(source, /label: "내 메모"/);
  assert.match(source, /label: "퀴즈"/);
  assert.doesNotMatch(source, /label: "전체 자막"/);
});

test("learning workspace never samples arbitrary captions as a summary", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const overview = readFileSync(
    resolve(featureDirectory, "LearningOverviewPanel.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /highlightIndexes|Math\.floor\(\(segments\.length/);
  assert.doesNotMatch(source, /video\.summary/);
  assert.match(overview, /내용 정리를 준비하고 있어요/);
  assert.match(overview, /이번 학습 정리/);
  assert.doesNotMatch(`${source}\n${overview}`, /AI 요약|자막 근거|문제 근거/);
});

test("full transcript opens as a drawer instead of a primary tab", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const drawer = readFileSync(
    resolve(featureDirectory, "TranscriptDrawer.tsx"),
    "utf8",
  );
  const current = readFileSync(
    resolve(featureDirectory, "CurrentSentencePanel.tsx"),
    "utf8",
  );

  assert.match(`${source}\n${current}`, />\s*전체 자막\s*</);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /전체 자막 닫기/);
});

test("YouTube loading and playback lifecycle stay behind one player interface", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningVideoPlayer.tsx"),
    "utf8",
  );

  assert.match(source, /export type LearningVideoPlayerHandle/);
  assert.match(source, /seek: \(seconds: number\) => void/);
  assert.match(source, /pause: \(\) => void/);
  assert.match(source, /play: \(\) => void/);
  assert.match(source, /pauseVideo: \(\) => void/);
  assert.match(source, /onStateChange/);
  assert.match(source, /getDuration/);
  assert.match(source, /youtubeApiPromise = null/);
  assert.match(source, /playerRef\.current\?\.destroy\(\)/);
  assert.match(source, /플레이어 스크립트를 불러오지 못했습니다/);
  assert.match(source, /\[scheduleControlsHide, videoId\]/);
  assert.doesNotMatch(source, /key=\{preferNativeCaptions/);
});

test("unfinished learning tools are presented as preparation states", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  const stateSource = readFileSync(
    resolve(featureDirectory, "captionState.ts"),
    "utf8",
  );
  const presentationSource = readFileSync(
    resolve(featureDirectory, "learningPanelPresentation.ts"),
    "utf8",
  );
  assert.match(stateSource, /문장 더 보면 퀴즈가 열려요/);
  assert.match(source, /const MAX_CAPTION_POLLS = 170/);
  assert.match(source, /startLearningIntake/);
  assert.match(presentationSource, /학습 자막 만들기/);
  assert.match(presentationSource, /다시 시도/);
  assert.doesNotMatch(source, /자막이 있는 다른 영상 선택/);
  assert.match(source, /canRetryCaptions/);
  assert.doesNotMatch(source, /Agent|MCP|RAG|AI/);
  assert.doesNotMatch(
    `${source}\n${stateSource}\n${presentationSource}`,
    /자막 근거|문제 근거|음성 자막 기능|원문 자막 확인 중/,
  );
});

test("native YouTube captions stay off while StudyTube captions are prepared", () => {
  const workspaceSource = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const playerSource = readFileSync(
    resolve(featureDirectory, "LearningVideoPlayer.tsx"),
    "utf8",
  );
  const optionsSource = readFileSync(
    resolve(featureDirectory, "youtubePlayerOptions.ts"),
    "utf8",
  );

  assert.doesNotMatch(workspaceSource, /preferNativeCaptions/);
  assert.match(workspaceSource, /caption=\{currentCaption\}/);
  assert.doesNotMatch(playerSource, /preferNativeCaptions/);
  assert.match(playerSource, /unloadModule\?\.\("captions"\)/);
  assert.match(playerSource, /nativeCaptionTicks/);
  assert.match(playerSource, /className="learning-player-caption"/);
  assert.match(optionsSource, /cc_load_policy:\s*0/);
});

test("player captions move with controls and expose three readable sizes", () => {
  const playerSource = readFileSync(
    resolve(featureDirectory, "LearningVideoPlayer.tsx"),
    "utf8",
  );
  const css = readFileSync(resolve(testDirectory, "../src/App.css"), "utf8");

  assert.match(playerSource, /controls-visible/);
  assert.match(playerSource, /const CONTROLS_HIDE_DELAY_MS = 4_200/);
  assert.match(playerSource, /자막 크기/);
  assert.match(playerSource, /small: "작게"/);
  assert.match(playerSource, /medium: "보통"/);
  assert.match(playerSource, /large: "크게"/);
  assert.match(
    css,
    /\.learning-player-caption\s*\{[^}]*bottom:\s*clamp\(44px,\s*7%,\s*58px\)/,
  );
  assert.match(
    css,
    /\.learning-player\.controls-visible\s+\.learning-player-caption\s*\{[^}]*bottom:\s*clamp\(84px,\s*15%,\s*120px\)/,
  );
  assert.match(css, /\.caption-size-small/);
  assert.match(css, /\.caption-size-large/);
  assert.match(
    css,
    /\.learning-caption-settings button\s*\{[^}]*min-height:\s*44px/,
  );
});

test("quiz polling waits for the bounded two-minute generation window", () => {
  const source = readFileSync(
    resolve(featureDirectory, "useAdaptiveQuiz.ts"),
    "utf8",
  );

  assert.match(source, /const MAX_QUIZ_POLLS = 80/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /fetchAdaptiveQuiz\(activeLoopId, \{ signal \}\)/);
  assert.match(source, /\[loopId, loopState\]/);
});

test("next proposal requests are single-flight and cancel polling on unmount", () => {
  const source = readFileSync(
    resolve(featureDirectory, "useNextLearningProposal.ts"),
    "utf8",
  );

  assert.match(source, /inFlight/);
  assert.match(source, /activeRequestRef/);
  assert.match(source, /waitForProposalRun\(run, signal\)/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /activeRequestRef\.current\?\.controller\.abort\(\)/);
});

test("starting a note pins the current playback position automatically", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const current = readFileSync(
    resolve(featureDirectory, "CurrentSentencePanel.tsx"),
    "utf8",
  );

  assert.match(source, /function startNoteDraft/);
  assert.match(source, /playerRef\.current\?\.pause\(\)/);
  assert.match(source, /notePositionSeconds: state\.currentTime/);
  assert.match(source, /selectedTab: "notes"/);
  assert.match(source, /noteInputRef\.current\?\.focus\(\)/);
  assert.match(current, />\s*이 문장 저장\s*</);
  assert.doesNotMatch(source, /현재 위치로 바꾸기/);
  assert.doesNotMatch(source, /positionSeconds: state\.currentTime/);
});

test("quiz readiness follows the captions currently shown to the learner", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  assert.match(
    source,
    /quizPreparation\(displayedCaptions, state\.currentTime\)/,
  );
  assert.match(source, /evidenceMessage:\s*quizState\.message/);
  assert.match(source, /canPrepareCaptions=\{quizState\.needsCaptions\}/);
});

test("quiz presents one content question at a time with custom choice cards", () => {
  const source = readFileSync(
    resolve(featureDirectory, "AdaptiveQuizPanel.tsx"),
    "utf8",
  );
  const css = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.css"),
    "utf8",
  );

  assert.match(source, /quizPage\(loop\?\.questions/);
  assert.match(source, /className="quiz-progress"/);
  assert.match(source, /"quiz-choice"/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /className="quiz-question-title"/);
  assert.match(source, /<div className="quiz-actions">/);
  assert.doesNotMatch(source, /<footer className="quiz-actions">/);
  assert.doesNotMatch(source, /<fieldset|<legend/);
  assert.match(
    source,
    /<header className="quiz-header">[\s\S]*className="quiz-score"[\s\S]*<\/header>/,
  );
  assert.doesNotMatch(source, /loop\?\.questions\.map/);
  assert.match(css, /\.quiz-choice-input\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.quiz-choice\s*\{[^}]*min-height:\s*44px/);
  assert.match(
    css,
    /\.quiz-question-title\s*\{[^}]*overflow-wrap:\s*anywhere/,
  );
  assert.match(
    css,
    /\.adaptive-quiz-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/,
  );
  assert.match(
    css,
    /\.adaptive-quiz-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});

test("learning playback records history and shows a clear completion action", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  assert.match(source, /recordLearningHistory/);
  assert.match(source, /onEnded=/);
  assert.match(source, /학습 완료/);
  assert.match(source, /다음 영상/);
});

test("sentence study actions pause playback before the sentence can change", () => {
  const workspace = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const current = readFileSync(
    resolve(featureDirectory, "CurrentSentencePanel.tsx"),
    "utf8",
  );

  assert.match(workspace, /onPause=\{pauseForStudy\}/);
  assert.match(current, /onPause\(\);[\s\S]*explainLearningSegment/);
  assert.match(workspace, /active:\s*state\.selectedTab === "quiz"/);
});

test("note composer keeps the pinned sentence beside the draft", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningNotesPanel.tsx"),
    "utf8",
  );

  assert.match(source, /고정된 장면/);
  assert.match(source, /source: string/);
  assert.match(source, /korean: string/);
  assert.match(source, /저장한 메모/);
});

test("captionless videos can create progressive captions from shared tab audio", () => {
  const workspaceSource = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const captureSource = readFileSync(
    resolve(featureDirectory, "useLiveCaptionCapture.ts"),
    "utf8",
  );
  const presentationSource = readFileSync(
    resolve(featureDirectory, "learningPanelPresentation.ts"),
    "utf8",
  );

  assert.match(workspaceSource, /useLiveCaptionCapture/);
  assert.match(workspaceSource, /captionPanel\.action === "capture"/);
  assert.match(workspaceSource, /captionPanel\.action === "stop"/);
  assert.match(presentationSource, /학습 자막 만들기/);
  assert.match(captureSource, /getDisplayMedia/);
  assert.match(captureSource, /systemAudio:\s*"exclude"/);
  assert.match(captureSource, /captureLiveCaptionChunk/);
  assert.match(captureSource, /finalizeLiveCaptions/);
  assert.match(captureSource, /const MAX_PENDING_UPLOADS = 2/);
  assert.match(captureSource, /const MAX_CAPTURE_MILLISECONDS = 10 \* 60 \* 1_000/);
  assert.doesNotMatch(workspaceSource, /음성 자막 기능|AI 자막/);
});

test("direct watch URLs select their video and start learning automatically", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );

  assert.match(source, /queueVideoFromDirectVideoId\(requestedVideoId\)/);
  assert.match(source, /if \(contextId \|\| intakeStartedRef\.current\) return/);
  assert.match(source, /void startLearningIntake\(\{/);
});

test("note save reconnects a stale learning context once before failing", () => {
  const source = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  assert.match(source, /async function createNoteWithContextRecovery/);
  assert.match(source, /Math\.round\(notePositionSeconds \* 1000\) \/ 1000/);
  assert.match(source, /error\.status !== 404/);
  assert.match(source, /const recovered = await startLearningIntake/);
  assert.match(source, /createLearningNote\(\{[\s\S]*contextId: recoveredContextId/);
});

test("learning workspace collapses safely at phone width", () => {
  const css = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.css"),
    "utf8",
  );

  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /\.learning-desk\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.learning-tools\s*\{[\s\S]*overflow:/);
  assert.match(css, /\.learning-tablist button[\s\S]*min-width: 0/);
  assert.match(
    css,
    /@media \(max-width: 520px\)[\s\S]*\.course-navigator\s*\{[^}]*flex-direction:\s*column/,
  );
  assert.match(
    css,
    /\.course-navigator-actions\s*\{[^}]*width:\s*100%/,
  );
});

test("a partial transcript that starts late repairs the opening automatically", () => {
  const workspace = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    resolve(featureDirectory, "CurrentSentencePanel.tsx"),
    "utf8",
  );

  assert.match(workspace, /needsInitialCaptionRepair/);
  assert.match(workspace, /repairInitialGap:\s*true/);
  assert.match(workspace, /initialGapRepairStartedRef/);
  assert.match(workspace, /liveCaptions\.start\(0\)/);
  assert.match(workspace, /seek\(0\)/);
  assert.match(workspace, /const started = await liveCaptions\.start\(0\)/);
  assert.match(workspace, /playerRef\.current\?\.play\(\)/);
  assert.match(workspace, /seek\(previousTime\)/);
  assert.match(panel, /앞부분 자막을 준비하고 있어요/);
  assert.match(panel, /처음부터 자막 시작/);
  assert.match(panel, /한국어 다시 준비/);
  assert.match(panel, /한국어 번역을 준비하지 못했어요/);
  assert.doesNotMatch(panel, /재생 위치를 옮기거나 전체 자막에서 문장을 골라 보세요/);
});

test("global theme keeps Korean words intact on a dark surface", () => {
  const theme = readFileSync(
    resolve(testDirectory, "../src/styles/theme.css"),
    "utf8",
  );

  assert.match(theme, /--app-background:\s*#0c0f14/i);
  assert.match(theme, /--app-surface:\s*#141922/i);
  assert.match(theme, /--app-accent:\s*#4c8dff/i);
  assert.match(theme, /word-break:\s*keep-all/);
  assert.match(theme, /overflow-wrap:\s*break-word/);
  assert.match(theme, /text-wrap:\s*pretty/);
  assert.doesNotMatch(theme, /overflow-wrap:\s*anywhere/);
});

test("learning panels override the retired white workspace surface", () => {
  const css = readFileSync(
    resolve(featureDirectory, "LearningWorkspace.css"),
    "utf8",
  );

  assert.match(
    css,
    /\.learning-workspace \.learning-tabs\s*\{[^}]*background:\s*var\(--app-surface\)/,
  );
  assert.match(
    css,
    /\.learning-workspace \.learning-tabpanel\s*\{[^}]*background:\s*var\(--app-surface\)/,
  );
  assert.match(
    css,
    /\.learning-overview-panel h2\s*\{[^}]*font-size:\s*24px/,
  );
});
