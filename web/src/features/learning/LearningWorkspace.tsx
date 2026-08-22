import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  createNextLearningProposal,
  createNextLearningRun,
  createLearningNote,
  deleteLearningNote,
  fetchAdaptiveQuiz,
  fetchNextLearningRun,
  fetchLearningCaptions,
  requestAdaptiveQuiz,
  submitAdaptiveQuiz,
  updateLearningNote,
  type AdaptiveQuizLoop,
  type AdaptiveQuizSubmission,
  type LearningProposal,
} from "../../api.ts";
import { fetchOwnerCourses } from "../../courseApi.ts";
import type { LearningNote, Session } from "../../types.ts";
import { formatTime } from "../../videoSummaryDetails.ts";
import type { QueueVideo } from "../../watchQueue.ts";
import { readWatchQueue } from "../../watchQueueStorage.ts";
import {
  captionPairAt,
  captionPhaseMessage,
  mergeCaptionState,
  quizPreparation,
  type ProgressiveCaptionState,
} from "./captionState.ts";
import { useLearningSession, type LearningTab } from "./useLearningSession.ts";
import {
  quizStateFromApi,
  transitionQuizState,
  type QuizUiState,
} from "./adaptiveQuizFlow.ts";
import {
  NextLearningProposal,
  type CourseChoice,
} from "./NextLearningProposal.tsx";

type LearningPlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};

type LearningYoutubeApi = {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars: Record<string, number>;
      events: {
        onReady: (event: { target: LearningPlayer }) => void;
        onError: () => void;
      };
    },
  ) => LearningPlayer;
};

type LearningWindow = Window & {
  YT?: LearningYoutubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

const TABS: Array<{ id: LearningTab; label: string }> = [
  { id: "transcript", label: "전체 자막" },
  { id: "notes", label: "메모" },
  { id: "quiz", label: "퀴즈" },
];
const MAX_CAPTION_POLLS = 8;
const MAX_QUIZ_POLLS = 10;

export function LearningWorkspace({ session }: { session: Session }) {
  const [searchParams] = useSearchParams();
  const [queue] = useState(() => readWatchQueue());
  const requestedVideoId = searchParams.get("videoId") ?? "";
  const currentVideo =
    queue.find((video) => video.videoId === requestedVideoId) ??
    queue[0] ??
    null;

  if (!currentVideo) return <EmptyWorkspace />;
  return (
    <ActiveLearningWorkspace
      key={`${session.user.id}:${currentVideo.videoId}`}
      userId={session.user.id}
      video={currentVideo}
    />
  );
}

function EmptyWorkspace() {
  return (
    <main className="page-shell learning-workspace-empty">
      <section>
        <p className="eyebrow">학습</p>
        <h1>아직 학습할 영상이 없습니다</h1>
        <p>
          영상 주소를 등록하면 이곳에서 자막, 메모와 퀴즈를 함께 볼 수 있습니다.
        </p>
        <Link className="primary-link" to="/">
          첫 영상 등록하기
        </Link>
      </section>
    </main>
  );
}

function ActiveLearningWorkspace({
  userId,
  video,
}: {
  userId: number;
  video: QueueVideo;
}) {
  const { state, update } = useLearningSession(userId, video.videoId);
  const [playerError, setPlayerError] = useState("");
  const [captionRefresh, setCaptionRefresh] = useState(0);
  const [noteBusyId, setNoteBusyId] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const [adaptiveQuiz, setAdaptiveQuiz] = useState<AdaptiveQuizLoop | null>(
    null,
  );
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSubmission, setQuizSubmission] =
    useState<AdaptiveQuizSubmission | null>(null);
  const [nextProposal, setNextProposal] = useState<LearningProposal | null>(
    null,
  );
  const [proposalCourses, setProposalCourses] = useState<CourseChoice[]>([]);
  const [proposalStatus, setProposalStatus] = useState("");
  const [proposalInFlight, setProposalInFlight] = useState(false);
  const [quizUi, setQuizUi] = useState<QuizUiState>(() =>
    quizStateFromApi(null, false),
  );
  const playerRef = useRef<LearningPlayer | null>(null);
  const initialTimeRef = useRef(state.currentTime);
  const captionsRef = useRef(state.captions);
  const tablistRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const quizStatusRef = useRef<HTMLDivElement>(null);
  const quizReadyRef = useRef(false);
  const proposalRequestRef = useRef<{
    controller: AbortController;
    idempotencyKey: string;
  } | null>(null);
  const currentCaption = captionPairAt(state.captions, state.currentTime);
  const quizState = quizPreparation(state.captions);
  const contextId = state.contextId || video.learningContextId || "";
  const quizLoopId = adaptiveQuiz?.id;
  const quizLoopState = adaptiveQuiz?.state;

  useEffect(() => {
    quizReadyRef.current = quizState.ready;
  }, [quizState.ready]);

  useEffect(() => {
    if (!adaptiveQuiz) setQuizUi(quizStateFromApi(null, quizState.ready));
  }, [adaptiveQuiz, quizState.ready]);

  useEffect(() => {
    if (!quizLoopId || quizLoopState !== "generating") return;
    const activeLoopId = quizLoopId;
    const controller = new AbortController();
    const { signal } = controller;

    async function pollQuiz() {
      if (!(await waitForPoll(500, signal))) return;
      for (let attempts = 0; attempts < MAX_QUIZ_POLLS; attempts += 1) {
        try {
          const next = await fetchAdaptiveQuiz(activeLoopId, { signal });
          if (signal.aborted) return;
          setAdaptiveQuiz(next);
          setQuizUi(quizStateFromApi(next, quizReadyRef.current));
          if (next.state !== "generating") return;
          if (attempts + 1 >= MAX_QUIZ_POLLS) return;
          if (!(await waitForPoll(1_500, signal))) return;
        } catch {
          if (!signal.aborted) {
            setQuizUi((current) => ({
              ...current,
              phase: "failed",
              message: "퀴즈 상태를 확인하지 못했습니다. 다시 시도해주세요.",
            }));
          }
          return;
        }
      }
    }
    void pollQuiz();
    return () => {
      controller.abort();
    };
  }, [quizLoopId, quizLoopState]);

  useEffect(
    () => () => {
      proposalRequestRef.current?.controller.abort();
      proposalRequestRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (["failed", "stale", "evaluated"].includes(quizUi.phase)) {
      quizStatusRef.current?.focus();
    }
  }, [quizUi.phase]);

  useEffect(() => {
    captionsRef.current = state.captions;
  }, [state.captions]);

  useEffect(() => {
    if (!state.contextId && video.learningContextId) {
      update({
        contextId: video.learningContextId,
        workId: video.learningWorkId ?? "",
      });
    }
  }, [state.contextId, update, video.learningContextId, video.learningWorkId]);

  useEffect(() => {
    let cancelled = false;
    let interval = 0;
    async function mountPlayer() {
      try {
        const youtube = await loadYoutubeApi();
        if (cancelled) return;
        playerRef.current?.destroy();
        playerRef.current = new youtube.Player("learning-youtube-player", {
          videoId: video.videoId,
          playerVars: { rel: 0, playsinline: 1, enablejsapi: 1 },
          events: {
            onReady: ({ target }) => {
              playerRef.current = target;
              target.seekTo(initialTimeRef.current, true);
              setPlayerError("");
            },
            onError: () => {
              setPlayerError(
                "영상을 재생할 수 없습니다. 원본 영상이 공개 상태인지 확인해주세요.",
              );
            },
          },
        });
        interval = window.setInterval(() => {
          try {
            const seconds = playerRef.current?.getCurrentTime();
            if (typeof seconds === "number" && Number.isFinite(seconds)) {
              update({ currentTime: seconds });
            }
          } catch {
            // Preserve the last valid position while the player is changing state.
          }
        }, 500);
      } catch {
        if (!cancelled) {
          setPlayerError(
            "플레이어를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.",
          );
        }
      }
    }
    void mountPlayer();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [update, video.videoId]);

  useEffect(() => {
    if (playerError) errorRef.current?.focus();
  }, [playerError]);

  useEffect(() => {
    if (!contextId) return;
    if (captionsRef.current.phase === "complete") return;
    let cancelled = false;
    let timeout = 0;
    let attempts = 0;
    let latest = captionsRef.current;

    async function poll() {
      attempts += 1;
      try {
        const response = await fetchLearningCaptions(contextId);
        if (cancelled) return;
        latest = mergeCaptionState(latest, response);
        update({ captions: latest });
        if (attempts < MAX_CAPTION_POLLS && latest.phase !== "complete") {
          timeout = window.setTimeout(poll, 1800);
        }
      } catch (error) {
        if (cancelled) return;
        latest = {
          ...latest,
          phase: latest.sourceSegments.length > 0 ? "partial" : "failed",
          stale: latest.sourceSegments.length > 0,
          errorMessage:
            error instanceof Error
              ? error.message
              : "자막을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
        };
        update({ captions: latest });
      }
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [captionRefresh, contextId, update]);

  function seek(seconds: number) {
    playerRef.current?.seekTo(seconds, true);
    update({ currentTime: seconds });
  }

  function selectTab(tab: LearningTab) {
    update({ selectedTab: tab });
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = TABS.findIndex((tab) => tab.id === state.selectedTab);
    let nextIndex: number;
    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(TABS[nextIndex].id);
    const buttons =
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  }

  async function saveNote() {
    const body = state.noteDraft.trim();
    if (!body) {
      setNoteStatus("메모 내용을 입력해주세요.");
      return;
    }
    if (!contextId) {
      setNoteStatus(
        "학습 자료 연결을 확인하고 있습니다. 잠시 후 다시 시도해주세요.",
      );
      return;
    }
    setNoteBusyId("new");
    setNoteStatus("메모를 저장하고 있습니다.");
    try {
      const note = await createLearningNote({
        contextId,
        positionSeconds: state.currentTime,
        body,
      });
      update({ notes: [note, ...state.notes], noteDraft: "" });
      setNoteStatus(`${formatTime(note.positionSeconds)} 메모를 저장했습니다.`);
    } catch (error) {
      setNoteStatus(
        error instanceof Error
          ? error.message
          : "메모를 저장하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setNoteBusyId("");
    }
  }

  async function editNote(note: LearningNote, body: string) {
    if (!contextId || !body.trim()) return;
    setNoteBusyId(note.id);
    try {
      const saved = await updateLearningNote({
        contextId,
        noteId: note.id,
        body,
      });
      update({
        notes: state.notes.map((item) => (item.id === note.id ? saved : item)),
      });
      setNoteStatus("메모를 수정했습니다.");
    } catch (error) {
      setNoteStatus(
        error instanceof Error ? error.message : "메모를 수정하지 못했습니다.",
      );
    } finally {
      setNoteBusyId("");
    }
  }

  async function removeNote(note: LearningNote) {
    if (!contextId) return;
    setNoteBusyId(note.id);
    try {
      await deleteLearningNote({ contextId, noteId: note.id });
      update({ notes: state.notes.filter((item) => item.id !== note.id) });
      setNoteStatus("메모를 삭제했습니다.");
    } catch (error) {
      setNoteStatus(
        error instanceof Error ? error.message : "메모를 삭제하지 못했습니다.",
      );
    } finally {
      setNoteBusyId("");
    }
  }

  async function startQuiz() {
    if (!contextId || !quizState.ready) return;
    setQuizSubmission(null);
    setQuizAnswers({});
    setQuizUi((current) => transitionQuizState(current, { type: "requested" }));
    try {
      const loop = await requestAdaptiveQuiz({
        contextId,
        startSeconds: 0,
        endSeconds: Math.max(1, Math.floor(state.currentTime)),
        idempotencyKey: crypto.randomUUID(),
      });
      setAdaptiveQuiz(loop);
      setQuizUi(quizStateFromApi(loop, true));
    } catch (error) {
      setQuizUi((current) => ({
        ...current,
        phase: "failed",
        message:
          error instanceof Error
            ? error.message
            : "퀴즈를 만들지 못했습니다. 다시 시도해주세요.",
      }));
    }
  }

  function chooseQuizAnswer(questionId: string, choiceIndex: number) {
    setQuizAnswers((current) => ({ ...current, [questionId]: choiceIndex }));
    setQuizUi((current) =>
      transitionQuizState(current, { type: "answer_changed" }),
    );
  }

  async function submitQuizAnswers() {
    if (!adaptiveQuiz || adaptiveQuiz.questions.length !== 5) return;
    const answers = adaptiveQuiz.questions.map((question) => ({
      questionId: question.id,
      selectedChoiceIndex: quizAnswers[question.id],
    }));
    if (answers.some((answer) => answer.selectedChoiceIndex === undefined)) {
      setQuizUi((current) => ({
        ...current,
        message: "모든 문제에 답해주세요.",
      }));
      return;
    }
    setQuizUi((current) =>
      transitionQuizState(current, { type: "submit_started" }),
    );
    try {
      const result = await submitAdaptiveQuiz({
        loopId: adaptiveQuiz.id,
        idempotencyKey: crypto.randomUUID(),
        answers: answers as Array<{
          questionId: string;
          selectedChoiceIndex: number;
        }>,
      });
      setQuizSubmission(result);
      setQuizUi((current) =>
        transitionQuizState(current, {
          type: "submit_succeeded",
          result: { score: result.attempt.score },
        }),
      );
    } catch (error) {
      try {
        const latest = await fetchAdaptiveQuiz(adaptiveQuiz.id);
        setAdaptiveQuiz(latest);
        setQuizUi(quizStateFromApi(latest, quizState.ready));
      } catch {
        setQuizUi((current) => ({
          ...current,
          phase: "failed",
          message:
            error instanceof Error
              ? error.message
              : "답을 확인하지 못했습니다. 다시 시도해주세요.",
        }));
      }
    }
  }

  async function requestNextProposal() {
    if (
      !contextId ||
      quizUi.phase !== "evaluated" ||
      proposalRequestRef.current
    )
      return;
    const request = {
      controller: new AbortController(),
      idempotencyKey: crypto.randomUUID(),
    };
    proposalRequestRef.current = request;
    const { signal } = request.controller;
    setProposalInFlight(true);
    setProposalStatus("다음 학습을 찾고 있습니다.");
    setNextProposal(null);
    try {
      const [run, courses] = await Promise.all([
        createNextLearningRun(
          {
            objective: `${video.title} 다음에 학습할 내용`,
            studyContextId: contextId,
            watchedRanges: [
              { start: 0, end: Math.max(1, Math.floor(state.currentTime)) },
            ],
            idempotencyKey: request.idempotencyKey,
          },
          { signal },
        ),
        fetchOwnerCourses(),
      ]);
      if (signal.aborted) return;
      setProposalCourses(
        courses
          .filter((course) => course.status !== "archived")
          .map(({ id, title, version }) => ({ id, title, version })),
      );
      const readyRun = await waitForProposalRun(run, signal);
      if (signal.aborted) return;
      if (readyRun.state !== "awaiting_approval") {
        throw new Error("다음 학습을 찾지 못했습니다. 다시 시도해주세요.");
      }
      const proposal = await createNextLearningProposal(readyRun.id, {
        signal,
      });
      if (signal.aborted) return;
      setNextProposal(proposal);
      setProposalStatus("");
    } catch (error) {
      if (signal.aborted) return;
      setProposalStatus(
        error instanceof Error
          ? error.message
          : "다음 학습을 찾지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      if (proposalRequestRef.current === request) {
        proposalRequestRef.current = null;
        if (!signal.aborted) setProposalInFlight(false);
      }
    }
  }

  return (
    <main className="page-shell learning-workspace">
      <header className="learning-workspace-heading">
        <div>
          <p className="eyebrow">학습 중</p>
          <h1>{video.title}</h1>
        </div>
        <Link to="/">다른 영상 학습</Link>
      </header>

      <section className="learning-player" aria-label="YouTube 영상 플레이어">
        <div id="learning-youtube-player" />
        {playerError && (
          <div
            className="learning-player-error"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            <strong>영상을 열 수 없습니다</strong>
            <p>{playerError}</p>
            <Link to="/">다른 영상 선택</Link>
          </div>
        )}
      </section>

      <section className="current-caption" aria-label="현재 자막">
        <div>
          <small>
            원문{" "}
            {state.captions.sourceLanguage &&
              `(${state.captions.sourceLanguage})`}
          </small>
          <p>{currentCaption.source || "원문 자막 확인 중"}</p>
        </div>
        <div>
          <small>한국어</small>
          <p>{currentCaption.korean || "한국어 자막을 준비하고 있습니다."}</p>
        </div>
        <p className="caption-progress" aria-live="polite">
          {contextId
            ? captionPhaseMessage(state.captions)
            : "이 영상을 새 학습으로 등록한 뒤 자막을 준비할 수 있습니다."}
        </p>
        {!contextId && <Link to="/">새 학습으로 등록</Link>}
        {contextId && state.captions.phase !== "complete" && (
          <button
            type="button"
            onClick={() => setCaptionRefresh((value) => value + 1)}
          >
            상태 새로고침
          </button>
        )}
      </section>

      <section className="learning-tabs">
        <div
          aria-label="학습 자료"
          className="learning-tablist"
          onKeyDown={handleTabKeyDown}
          ref={tablistRef}
          role="tablist"
        >
          {TABS.map((tab) => (
            <button
              aria-controls={`learning-panel-${tab.id}`}
              aria-selected={state.selectedTab === tab.id}
              id={`learning-tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              role="tab"
              tabIndex={state.selectedTab === tab.id ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          aria-labelledby={`learning-tab-${state.selectedTab}`}
          className="learning-tabpanel"
          id={`learning-panel-${state.selectedTab}`}
          role="tabpanel"
          tabIndex={0}
        >
          {state.selectedTab === "transcript" && (
            <TranscriptPanel captions={state.captions} onSeek={seek} />
          )}
          {state.selectedTab === "notes" && (
            <section className="learning-notes-panel">
              <label htmlFor="learning-note">
                {formatTime(state.currentTime)} 메모
              </label>
              <textarea
                id="learning-note"
                value={state.noteDraft}
                onChange={(event) => update({ noteDraft: event.target.value })}
                placeholder="지금 구간에서 기억할 내용을 적어보세요."
              />
              <button
                disabled={noteBusyId === "new"}
                type="button"
                onClick={saveNote}
              >
                현재 시점에 저장
              </button>
              <p aria-live="polite">{noteStatus}</p>
              <div className="learning-note-list">
                {state.notes.map((note) => (
                  <NoteEditor
                    busy={noteBusyId === note.id}
                    key={note.id}
                    note={note}
                    onDelete={() => removeNote(note)}
                    onSave={(body) => editNote(note, body)}
                    onSeek={() => seek(note.positionSeconds)}
                  />
                ))}
                {state.notes.length === 0 && (
                  <p>아직 저장한 메모가 없습니다.</p>
                )}
              </div>
            </section>
          )}
          {state.selectedTab === "quiz" && (
            <AdaptiveQuizPanel
              answers={quizAnswers}
              loop={adaptiveQuiz}
              onAnswer={chooseQuizAnswer}
              onRequest={startQuiz}
              onSeek={seek}
              onSubmit={submitQuizAnswers}
              state={quizUi}
              statusRef={quizStatusRef}
              submission={quizSubmission}
            />
          )}
        </div>
      </section>
      {quizUi.phase === "evaluated" && !nextProposal && (
        <section className="next-learning-entry" aria-live="polite">
          <h2>다음 학습</h2>
          <p>
            퀴즈 결과와 지금까지 본 구간을 바탕으로 이어서 볼 영상을 찾습니다.
          </p>
          <button
            aria-busy={proposalInFlight}
            disabled={proposalInFlight}
            type="button"
            onClick={() => void requestNextProposal()}
          >
            {proposalInFlight ? "다음 학습 찾는 중" : "다음 학습 제안 받기"}
          </button>
          <p>{proposalStatus}</p>
        </section>
      )}
      {nextProposal && (
        <NextLearningProposal
          proposal={nextProposal}
          courses={proposalCourses}
          onRequestAnother={() => void requestNextProposal()}
        />
      )}
    </main>
  );
}

async function waitForProposalRun(
  initial: {
    id: string;
    state: string;
    failureCode: string | null;
  },
  signal: AbortSignal,
) {
  let current = initial;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      current.state === "awaiting_approval" ||
      ["failed", "cancelled"].includes(current.state)
    ) {
      return current;
    }
    if (!(await waitForPoll(1_000, signal))) return current;
    current = await fetchNextLearningRun(current.id, { signal });
  }
  return current;
}

function waitForPoll(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, delayMs);
    function stop() {
      window.clearTimeout(timeout);
      resolve(false);
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

function AdaptiveQuizPanel({
  answers,
  loop,
  onAnswer,
  onRequest,
  onSeek,
  onSubmit,
  state,
  statusRef,
  submission,
}: {
  answers: Record<string, number>;
  loop: AdaptiveQuizLoop | null;
  onAnswer: (questionId: string, choiceIndex: number) => void;
  onRequest: () => void;
  onSeek: (seconds: number) => void;
  onSubmit: () => void;
  state: QuizUiState;
  statusRef: React.RefObject<HTMLDivElement | null>;
  submission: AdaptiveQuizSubmission | null;
}) {
  if (["request", "generating", "failed", "stale"].includes(state.phase)) {
    return (
      <section className="learning-preparing-state">
        <h2>지금까지 퀴즈</h2>
        <div aria-live="polite" ref={statusRef} tabIndex={-1}>
          {state.message}
        </div>
        {state.phase === "generating" && (
          <span>완료되면 자동으로 표시됩니다.</span>
        )}
        {state.phase === "request" && state.evidenceReady && (
          <button type="button" onClick={onRequest}>
            퀴즈 만들기
          </button>
        )}
        {state.phase === "request" && !state.evidenceReady && (
          <span>자막 근거가 준비되면 시작할 수 있습니다.</span>
        )}
        {state.phase === "failed" && (
          <button type="button" onClick={onRequest}>
            다시 만들기
          </button>
        )}
        {state.phase === "stale" && (
          <button type="button" onClick={onRequest}>
            새 퀴즈 만들기
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="adaptive-quiz-panel">
      <h2>지금까지 퀴즈</h2>
      {loop?.questions.map((question) => {
        const evaluated = submission?.attempt.answers.find(
          (answer) => answer.questionId === question.id,
        );
        return (
          <fieldset key={question.id}>
            <legend>
              {question.position}. {question.prompt}
            </legend>
            {question.choices.map((choice, index) => (
              <label key={choice}>
                <input
                  checked={answers[question.id] === index}
                  disabled={
                    state.phase === "submitting" || state.phase === "evaluated"
                  }
                  name={question.id}
                  onChange={() => onAnswer(question.id, index)}
                  type="radio"
                />
                {choice}
              </label>
            ))}
            {evaluated && (
              <div>
                <p>
                  {evaluated.correct
                    ? "정답입니다."
                    : "다시 볼 부분이 있습니다."}
                </p>
                <p>{evaluated.explanation}</p>
                <button
                  type="button"
                  onClick={() => onSeek(evaluated.citation.startSeconds)}
                >
                  {formatTime(evaluated.citation.startSeconds)} 근거 보기
                </button>
              </div>
            )}
          </fieldset>
        );
      })}
      {(state.phase === "ready" || state.phase === "answering") && (
        <button
          disabled={state.phase !== "answering"}
          type="button"
          onClick={onSubmit}
        >
          답 확인하기
        </button>
      )}
      {state.phase === "submitting" && <p>답을 확인하고 있습니다.</p>}
      {state.phase === "evaluated" && submission && (
        <div ref={statusRef} tabIndex={-1}>
          <p>점수 {submission.attempt.score}점</p>
          {submission.reviewProposal && (
            <button
              type="button"
              onClick={() =>
                onSeek(submission.reviewProposal!.citation.startSeconds)
              }
            >
              복습 구간으로 이동
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function TranscriptPanel({
  captions,
  onSeek,
}: {
  captions: ProgressiveCaptionState;
  onSeek: (seconds: number) => void;
}) {
  if (
    captions.sourceSegments.length === 0 &&
    captions.koreanSegments.length === 0
  ) {
    return (
      <section className="learning-preparing-state">
        <h2>전체 자막</h2>
        <p>{captionPhaseMessage(captions)}</p>
      </section>
    );
  }
  const starts = Array.from(
    new Set(
      [...captions.sourceSegments, ...captions.koreanSegments].map(
        (segment) => segment.start,
      ),
    ),
  ).sort((left, right) => left - right);
  return (
    <ol className="learning-transcript">
      {starts.map((start) => {
        const pair = captionPairAt(captions, start + 0.001);
        return (
          <li key={start}>
            <button type="button" onClick={() => onSeek(start)}>
              {formatTime(start)}
            </button>
            <div>
              {pair.source && (
                <p lang={captions.sourceLanguage || undefined}>{pair.source}</p>
              )}
              <p lang="ko">
                {pair.korean || "한국어 자막을 준비하고 있습니다."}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function NoteEditor({
  busy,
  note,
  onDelete,
  onSave,
  onSeek,
}: {
  busy: boolean;
  note: LearningNote;
  onDelete: () => void;
  onSave: (body: string) => void;
  onSeek: () => void;
}) {
  const [body, setBody] = useState(note.body);
  return (
    <article>
      <button className="note-time" type="button" onClick={onSeek}>
        {formatTime(note.positionSeconds)}로 이동
      </button>
      <textarea
        aria-label={`${formatTime(note.positionSeconds)} 메모 내용`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div>
        <button
          disabled={busy || body.trim() === note.body}
          type="button"
          onClick={() => onSave(body)}
        >
          수정 저장
        </button>
        <button disabled={busy} type="button" onClick={onDelete}>
          삭제
        </button>
      </div>
    </article>
  );
}

let youtubeApiPromise: Promise<LearningYoutubeApi> | null = null;

function loadYoutubeApi(): Promise<LearningYoutubeApi> {
  const learningWindow = window as unknown as LearningWindow;
  if (learningWindow.YT?.Player) return Promise.resolve(learningWindow.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("플레이어 준비 시간이 초과되었습니다.")),
      8000,
    );
    const previousReady = learningWindow.onYouTubeIframeAPIReady;
    learningWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (!learningWindow.YT?.Player) return;
      window.clearTimeout(timeout);
      resolve(learningWindow.YT);
    };
    if (
      !document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]',
      )
    ) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("플레이어 스크립트를 불러오지 못했습니다."));
      };
      document.head.append(script);
    }
  });
  return youtubeApiPromise;
}
