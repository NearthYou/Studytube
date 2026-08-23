import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  createLearningNote,
  deleteLearningNote,
  fetchLearningCaptions,
  ApiRequestError,
  updateLearningNote,
  type AdaptiveQuizLoop,
  type AdaptiveQuizSubmission,
} from "../../api.ts";
import type { LearningNote, Session } from "../../types.ts";
import { startLearningIntake } from "../../learningIntake.ts";
import { formatTime } from "../../videoSummaryDetails.ts";
import {
  queueVideoFromDirectVideoId,
  type QueueVideo,
} from "../../watchQueue.ts";
import { readWatchQueue } from "../../watchQueueStorage.ts";
import {
  captionPairAt,
  captionPhaseMessage,
  canRetryCaptions,
  EMPTY_CAPTION_STATE,
  mergeCaptionState,
  quizPreparation,
  type ProgressiveCaptionState,
} from "./captionState.ts";
import { useLearningSession, type LearningTab } from "./useLearningSession.ts";
import type { QuizUiState } from "./adaptiveQuizFlow.ts";
import { NextLearningProposal } from "./NextLearningProposal.tsx";
import {
  LearningVideoPlayer,
  type LearningVideoPlayerHandle,
} from "./LearningVideoPlayer.tsx";
import { useAdaptiveQuiz } from "./useAdaptiveQuiz.ts";
import { useNextLearningProposal } from "./useNextLearningProposal.ts";

const TABS: Array<{ id: LearningTab; label: string }> = [
  { id: "summary", label: "문장 해설" },
  { id: "transcript", label: "전체 자막" },
  { id: "notes", label: "저장 문장" },
  { id: "quiz", label: "퀴즈" },
];
const MAX_CAPTION_POLLS = 170;
const REQUESTED_AUDIO_SECONDS = 600;

export function LearningWorkspace({ session }: { session: Session }) {
  const [searchParams] = useSearchParams();
  const [queue] = useState(() => readWatchQueue());
  const requestedVideoId = searchParams.get("videoId") ?? "";
  const requestedVideo = requestedVideoId
    ? (queue.find((video) => video.videoId === requestedVideoId) ??
      queueVideoFromDirectVideoId(requestedVideoId))
    : null;
  const currentVideo = requestedVideo ?? queue[0] ?? null;

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
  const [captionRefresh, setCaptionRefresh] = useState(0);
  const [captionRetrying, setCaptionRetrying] = useState(false);
  const [noteBusyId, setNoteBusyId] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const playerRef = useRef<LearningVideoPlayerHandle | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const captionsRef = useRef(state.captions);
  const intakeStartedRef = useRef(false);
  const tablistRef = useRef<HTMLDivElement>(null);
  const notePositionSeconds =
    state.notePositionSeconds ?? state.currentTime;
  const currentCaption = captionPairAt(state.captions, state.currentTime);
  const quizState = quizPreparation(state.captions);
  const contextId = state.contextId || video.learningContextId || "";
  const quiz = useAdaptiveQuiz({
    contextId,
    currentTime: state.currentTime,
    evidenceReady: quizState.ready,
  });
  const nextLearning = useNextLearningProposal({
    contextId,
    currentTime: state.currentTime,
    evaluated: quiz.state.phase === "evaluated",
    videoTitle: video.title,
  });

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
    if (contextId || intakeStartedRef.current) return;
    intakeStartedRef.current = true;
    void startLearningIntake({
      videoUrl: video.videoUrl,
      requestedAudioSeconds: REQUESTED_AUDIO_SECONDS,
    })
      .then((result) => {
        update({
          contextId: result.context.studyContext.id,
          workId: result.workId,
          captions: EMPTY_CAPTION_STATE,
        });
      })
      .catch((error: unknown) => {
        update({
          captions: {
            ...EMPTY_CAPTION_STATE,
            phase: "failed",
            errorMessage:
              error instanceof Error
                ? error.message
                : "학습을 준비하지 못했습니다. 다시 시도해주세요.",
          },
        });
      });
  }, [contextId, update, video.videoUrl]);

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
        if (
          attempts < MAX_CAPTION_POLLS &&
          latest.phase !== "complete" &&
          latest.phase !== "failed"
        ) {
          timeout = window.setTimeout(poll, 1800);
        } else if (
          attempts >= MAX_CAPTION_POLLS &&
          latest.phase !== "complete" &&
          latest.phase !== "failed"
        ) {
          latest = {
            ...latest,
            phase: latest.sourceSegments.length > 0 ? "partial" : "failed",
            stale: latest.sourceSegments.length > 0,
            errorMessage: latest.sourceSegments.length > 0
              ? "나머지 자막이 늦어지고 있어요. 잠시 후 다시 확인해주세요."
              : "자막 준비가 늦어지고 있어요. 다시 시도해주세요.",
          };
          update({ captions: latest });
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

  async function retryCaptions() {
    setCaptionRetrying(true);
    update({ captions: EMPTY_CAPTION_STATE });
    try {
      const result = await startLearningIntake({
        videoUrl: video.videoUrl,
        requestedAudioSeconds: REQUESTED_AUDIO_SECONDS,
      });
      update({
        contextId: result.context.studyContext.id,
        workId: result.workId,
        captions: EMPTY_CAPTION_STATE,
      });
      setCaptionRefresh((value) => value + 1);
    } catch (error) {
      update({
        captions: {
          ...EMPTY_CAPTION_STATE,
          phase: "failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "자막을 다시 만들지 못했습니다. 잠시 후 다시 시도해주세요.",
        },
      });
    } finally {
      setCaptionRetrying(false);
    }
  }

  function seek(seconds: number) {
    playerRef.current?.seek(seconds);
    update({ currentTime: seconds });
  }

  function selectTab(tab: LearningTab) {
    update({ selectedTab: tab });
  }

  function startNoteDraft() {
    update({
      selectedTab: "notes",
      notePositionSeconds: state.currentTime,
    });
    queueMicrotask(() => noteInputRef.current?.focus());
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

  function updateNoteDraft(noteDraft: string) {
    update({
      noteDraft,
      notePositionSeconds: noteDraft
        ? (state.notePositionSeconds ?? state.currentTime)
        : null,
    });
  }

  async function createNoteWithContextRecovery(body: string) {
    const safePositionSeconds = Math.round(notePositionSeconds * 1000) / 1000;
    try {
      return await createLearningNote({
        contextId,
        positionSeconds: safePositionSeconds,
        body,
      });
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 404) {
        throw error;
      }
      const recovered = await startLearningIntake({
        videoUrl: video.videoUrl,
        requestedAudioSeconds: REQUESTED_AUDIO_SECONDS,
      });
      const recoveredContextId = recovered.context.studyContext.id;
      update({
        contextId: recoveredContextId,
        workId: recovered.workId,
      });
      return createLearningNote({
        contextId: recoveredContextId,
        positionSeconds: safePositionSeconds,
        body,
      });
    }
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
      const note = await createNoteWithContextRecovery(body);
      update({
        notes: [note, ...state.notes],
        noteDraft: "",
        notePositionSeconds: null,
      });
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

  return (
    <main className="page-shell learning-workspace">
      <header className="learning-workspace-heading">
        <div>
          <p className="eyebrow">학습 중</p>
          <h1>{video.title}</h1>
        </div>
        <Link to="/">다른 영상 학습</Link>
      </header>

      <div className="learning-desk">
        <section className="learning-stage">
          <LearningVideoPlayer
            caption={currentCaption}
            initialTime={state.currentTime}
            onTimeChange={(currentTime) => update({ currentTime })}
            preferNativeCaptions={state.captions.sourceSegments.length === 0}
            ref={playerRef}
            videoId={video.videoId}
          />

          <section className="current-caption" aria-label="현재 자막">
        <div>
          <small>
            원문{" "}
            {state.captions.sourceLanguage &&
              `(${state.captions.sourceLanguage})`}
          </small>
          <p>{currentCaption.source || "자막을 불러오는 중이에요."}</p>
        </div>
        <div>
          <small>한국어</small>
          <p>{currentCaption.korean || "한국어로 옮기는 중이에요."}</p>
        </div>
        <p className="caption-progress" aria-live="polite">
          {contextId
            ? captionPhaseMessage(state.captions)
            : "이 영상을 새 학습으로 등록한 뒤 자막을 준비할 수 있습니다."}
        </p>
        {!contextId && <Link to="/">새 학습으로 등록</Link>}
        {contextId &&
        state.captions.phase === "failed" &&
        !canRetryCaptions(state.captions.errorCode) ? (
          <p className="caption-fallback-note">
            자막 없이도 영상 설명과 공개 정보로 학습을 계속할 수 있습니다.
          </p>
        ) : contextId && state.captions.phase === "failed" ? (
          <button
            disabled={captionRetrying}
            type="button"
            onClick={() => void retryCaptions()}
          >
            {captionRetrying ? "다시 준비하고 있어요" : "자막 다시 만들기"}
          </button>
        ) : contextId && state.captions.phase !== "complete" ? (
          <button
            type="button"
            onClick={() => setCaptionRefresh((value) => value + 1)}
          >
            상태 새로고침
          </button>
        ) : null}
          </section>
          <div className="learning-source-status">
            {state.captions.sourceSegments.length === 0 &&
            state.captions.phase === "failed"
              ? "영상 설명과 공개 정보로 학습 내용을 정리했어요."
              : "자막과 영상 정보를 함께 정리하고 있어요."}
          </div>
        </section>

        <section className="learning-tools" aria-label="학습 도구">
          <div className="learning-tools-heading">
            <span>{formatTime(state.currentTime)}</span>
            <button type="button" onClick={startNoteDraft}>
              메모하기
            </button>
          </div>
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
          {state.selectedTab === "summary" && (
            <LearningSummaryPanel
              captions={state.captions}
              onSeek={seek}
              video={video}
            />
          )}
          {state.selectedTab === "transcript" && (
            <TranscriptPanel captions={state.captions} onSeek={seek} />
          )}
          {state.selectedTab === "notes" && (
            <section className="learning-notes-panel">
              <label htmlFor="learning-note">
                {formatTime(notePositionSeconds)}에 메모
              </label>
              <textarea
                id="learning-note"
                ref={noteInputRef}
                value={state.noteDraft}
                onChange={(event) => updateNoteDraft(event.target.value)}
                placeholder="지금 구간에서 기억할 내용을 적어보세요."
              />
              <div className="learning-note-actions">
                <button
                  disabled={noteBusyId === "new" || !state.noteDraft.trim()}
                  type="button"
                  onClick={saveNote}
                >
                  저장
                </button>
              </div>
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
              answers={quiz.answers}
              loop={quiz.loop}
              onAnswer={quiz.chooseAnswer}
              onRequest={() => void quiz.request()}
              onSeek={seek}
              onSubmit={() => void quiz.submit()}
              state={quiz.state}
              statusRef={quiz.statusRef}
              submission={quiz.submission}
            />
          )}
        </div>
          </section>
        </section>
      </div>
      {quiz.state.phase === "evaluated" && !nextLearning.proposal && (
        <section className="next-learning-entry" aria-live="polite">
          <h2>다음 학습</h2>
          <p>
            퀴즈 결과와 지금까지 본 구간을 바탕으로 이어서 볼 영상을 찾습니다.
          </p>
          <button
            aria-busy={nextLearning.inFlight}
            disabled={nextLearning.inFlight}
            type="button"
            onClick={() => void nextLearning.request()}
          >
            {nextLearning.inFlight
              ? "다음 학습 찾는 중"
              : "다음 학습 제안 받기"}
          </button>
          <p>{nextLearning.status}</p>
        </section>
      )}
      {nextLearning.proposal && (
        <NextLearningProposal
          proposal={nextLearning.proposal}
          courses={nextLearning.courses}
          onRequestAnother={() => void nextLearning.request()}
        />
      )}
    </main>
  );
}

function LearningSummaryPanel({
  captions,
  onSeek,
  video,
}: {
  captions: ProgressiveCaptionState;
  onSeek: (seconds: number) => void;
  video: QueueVideo;
}) {
  const segments =
    captions.koreanSegments.length > 0
      ? captions.koreanSegments
      : captions.sourceSegments;
  const highlightIndexes = Array.from(
    new Set(
      segments.length > 0
        ? [0, Math.floor((segments.length - 1) / 2), segments.length - 1]
        : [],
    ),
  );
  return (
    <section className="learning-summary-panel">
      <h2>핵심 내용</h2>
      <p>
        {video.summary.trim() ||
          `${video.channelName || "YouTube"}의 ${video.title} 영상입니다.`}
      </p>
      {highlightIndexes.length > 0 ? (
        <ol>
          {highlightIndexes.map((index) => {
            const segment = segments[index];
            return (
              <li key={`${segment.start}:${segment.end}`}>
                <button type="button" onClick={() => onSeek(segment.start)}>
                  {formatTime(segment.start)}
                </button>
                <p>{segment.text}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>자막이 준비되면 중요한 내용을 여기에서 바로 볼 수 있어요.</p>
      )}
    </section>
  );
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
          <span>자막이 준비되면 퀴즈를 시작할 수 있어요.</span>
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
                {pair.korean || "한국어로 옮기는 중이에요."}
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
