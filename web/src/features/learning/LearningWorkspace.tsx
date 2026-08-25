import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  createLearningNote,
  deleteLearningNote,
  fetchLearningCaptions,
  ApiRequestError,
  updateLearningNote,
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
import { NextLearningProposal } from "./NextLearningProposal.tsx";
import {
  LearningVideoPlayer,
  type LearningVideoPlayerHandle,
} from "./LearningVideoPlayer.tsx";
import { useAdaptiveQuiz } from "./useAdaptiveQuiz.ts";
import { useNextLearningProposal } from "./useNextLearningProposal.ts";
import { useLiveCaptionCapture } from "./useLiveCaptionCapture.ts";
import { CurrentSentencePanel } from "./CurrentSentencePanel.tsx";
import { LearningOverviewPanel } from "./LearningOverviewPanel.tsx";
import { TranscriptDrawer } from "./TranscriptDrawer.tsx";
import { LearningNotesPanel } from "./LearningNotesPanel.tsx";
import { AdaptiveQuizPanel } from "./AdaptiveQuizPanel.tsx";
import { CourseNavigator } from "./CourseNavigator.ts";
import { captionlessPanelPresentation } from "./learningPanelPresentation.ts";
import {
  readLearningHistory,
  recordLearningHistory,
} from "./learningHistory.ts";
import "./LearningWorkspace.css";

const TABS: Array<{ id: LearningTab; label: string }> = [
  { id: "current", label: "지금 문장" },
  { id: "overview", label: "내용 정리" },
  { id: "notes", label: "내 메모" },
  { id: "quiz", label: "퀴즈" },
];
const MAX_CAPTION_POLLS = 170;
const REQUESTED_AUDIO_SECONDS = 600;

export function LearningWorkspace({ session }: { session: Session }) {
  const navigate = useNavigate();
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
      queue={queue}
      onSelectVideo={(selected) =>
        navigate(`/watch?videoId=${selected.videoId}`)
      }
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
  queue,
  onSelectVideo,
}: {
  userId: number;
  video: QueueVideo;
  queue: QueueVideo[];
  onSelectVideo: (video: QueueVideo) => void;
}) {
  const { state, update } = useLearningSession(userId, video.videoId);
  const [captionRefresh, setCaptionRefresh] = useState(0);
  const [captionRetrying, setCaptionRetrying] = useState(false);
  const [noteBusyId, setNoteBusyId] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [videoEnded, setVideoEnded] = useState(false);
  const playerRef = useRef<LearningVideoPlayerHandle | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const captionsRef = useRef(state.captions);
  const intakeStartedRef = useRef(false);
  const tablistRef = useRef<HTMLDivElement>(null);
  const lastHistoryWriteRef = useRef(0);
  const [historyEntry] = useState(() =>
    readLearningHistory().find(
      (entry) => entry.video.videoId === video.videoId,
    ),
  );
  const notePositionSeconds =
    state.notePositionSeconds ?? state.currentTime;
  const contextId = state.contextId || video.learningContextId || "";
  const courseVideos = video.course
    ? queue.filter((item) => item.course?.id === video.course?.id)
    : [];
  const orderedCourseVideos = [...courseVideos].sort(
    (left, right) =>
      (left.course?.position ?? 0) - (right.course?.position ?? 0),
  );
  const currentCourseIndex = orderedCourseVideos.findIndex(
    (item) => item.videoId === video.videoId,
  );
  const nextCourseVideo = orderedCourseVideos[currentCourseIndex + 1] ?? null;
  const handleLiveFinalized = useCallback(
    () => setCaptionRefresh((value) => value + 1),
    [],
  );
  const liveCaptions = useLiveCaptionCapture({
    contextId,
    currentTime: state.currentTime,
    onFinalized: handleLiveFinalized,
  });
  const displayedCaptions: ProgressiveCaptionState =
    liveCaptions.chunks.length > 0
      ? {
          ...state.captions,
          phase: liveCaptions.active ? "partial" : "index_pending",
          sourceLanguage:
            liveCaptions.chunks[0]?.sourceLanguage ||
            state.captions.sourceLanguage,
          sourceSegments: liveCaptions.chunks.map((chunk) => ({
            start: chunk.start,
            end: chunk.end,
            text: chunk.source,
          })),
          koreanSegments: liveCaptions.chunks
            .filter((chunk) => chunk.korean)
            .map((chunk) => ({
              start: chunk.start,
              end: chunk.end,
              text: chunk.korean,
            })),
          stale: false,
          errorMessage: undefined,
          errorCode: undefined,
        }
      : state.captions;
  const currentCaption = captionPairAt(displayedCaptions, state.currentTime);
  const noteCaption = captionPairAt(displayedCaptions, notePositionSeconds);
  const captionsReady = displayedCaptions.sourceSegments.length > 0;
  const captionPanel = captionlessPanelPresentation({
    contextReady: Boolean(contextId),
    liveActive: liveCaptions.active,
    phase: displayedCaptions.phase,
    retrying: captionRetrying,
    retryable: canRetryCaptions(state.captions.errorCode),
  });
  const currentSegment =
    displayedCaptions.sourceSegments.find(
      (segment) =>
        state.currentTime >= segment.start && state.currentTime < segment.end,
    ) ?? displayedCaptions.sourceSegments[0];
  const quizState = quizPreparation(state.captions, state.currentTime);
  const quiz = useAdaptiveQuiz({
    active: state.selectedTab === "quiz",
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

  function handleCaptionPanelAction() {
    if (captionPanel.action === "stop") {
      liveCaptions.stop();
      return;
    }
    if (captionPanel.action === "retry") {
      void retryCaptions();
      return;
    }
    if (captionPanel.action === "capture") {
      void liveCaptions.start();
    }
  }

  function seek(seconds: number) {
    setVideoEnded(false);
    playerRef.current?.seek(seconds);
    update({ currentTime: seconds });
  }

  function trackPlayback(currentTime: number) {
    update({ currentTime });
    const now = Date.now();
    if (now - lastHistoryWriteRef.current < 5_000) return;
    lastHistoryWriteRef.current = now;
    recordLearningHistory({
      video,
      positionSeconds: currentTime,
      durationSeconds,
    });
  }

  function finishVideo(positionSeconds: number, playerDuration: number) {
    const completedDuration = playerDuration || durationSeconds;
    setDurationSeconds(completedDuration);
    setVideoEnded(true);
    update({ currentTime: positionSeconds });
    recordLearningHistory({
      video,
      positionSeconds,
      durationSeconds: completedDuration,
      completed: true,
    });
  }

  function pauseForStudy() {
    playerRef.current?.pause();
  }

  function selectTab(tab: LearningTab) {
    if (tab === "notes" || tab === "quiz") pauseForStudy();
    update(
      tab === "notes"
        ? {
            selectedTab: tab,
            notePositionSeconds:
              state.notePositionSeconds ?? state.currentTime,
          }
        : { selectedTab: tab },
    );
  }

  function startNoteDraft() {
    pauseForStudy();
    update({
      selectedTab: "notes",
      notePositionSeconds: state.currentTime,
    });
    queueMicrotask(() => noteInputRef.current?.focus());
  }

  function prepareCaptionsForQuiz() {
    pauseForStudy();
    update({ selectedTab: "current" });
    handleCaptionPanelAction();
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

      <CourseNavigator
        currentVideoId={video.videoId}
        onSelect={onSelectVideo}
        videos={courseVideos}
      />

      <div className="learning-desk">
        <section className="learning-stage">
          <LearningVideoPlayer
            caption={currentCaption}
            initialTime={
              historyEntry?.completed
                ? 0
                : state.currentTime || historyEntry?.lastPositionSeconds || 0
            }
            onDurationChange={setDurationSeconds}
            onEnded={finishVideo}
            onTimeChange={trackPlayback}
            preferNativeCaptions={displayedCaptions.sourceSegments.length === 0}
            ref={playerRef}
            videoId={video.videoId}
          />

          {videoEnded && (
            <section className="learning-completion-card" aria-live="polite">
              <div>
                <strong>학습 완료</strong>
                <span>이 영상의 진도를 기록했습니다.</span>
              </div>
              {nextCourseVideo ? (
                <button type="button" onClick={() => onSelectVideo(nextCourseVideo)}>
                  다음 영상
                </button>
              ) : (
                <Link to="/courses">다음 영상 찾기</Link>
              )}
            </section>
          )}

          <div className="learning-source-status">
            {!captionsReady && state.captions.phase === "failed"
              ? "영상은 바로 볼 수 있어요. 학습 자막은 오른쪽에서 만들 수 있습니다."
              : captionsReady
                ? "재생 위치에 맞춰 문장과 학습 내용을 보여드려요."
                : "학습 자막을 준비하고 있어요."}
          </div>
        </section>

        <section className="learning-tools" aria-label="학습 도구">
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
          {state.selectedTab === "current" && (
            <CurrentSentencePanel
              key={`${currentSegment?.start ?? state.currentTime}:${currentSegment?.end ?? state.currentTime}`}
              captionsReady={captionsReady}
              contextId={contextId}
              currentTime={state.currentTime}
              emptyState={captionPanel}
              korean={currentCaption.korean}
              onEmptyAction={handleCaptionPanelAction}
              onOpenTranscript={() => setTranscriptOpen(true)}
              onPause={pauseForStudy}
              onSave={startNoteDraft}
              segmentEnd={currentSegment?.end ?? state.currentTime}
              segmentStart={currentSegment?.start ?? state.currentTime}
              source={currentCaption.source}
              sourceLanguage={displayedCaptions.sourceLanguage}
              status={
                liveCaptions.message ||
                (contextId
                  ? captionPhaseMessage(displayedCaptions)
                  : "영상을 학습 목록에 담고 있어요.")
              }
            />
          )}
          {state.selectedTab === "overview" && (
            <LearningOverviewPanel
              active={state.selectedTab === "overview"}
              contextId={contextId}
              onSeek={seek}
            />
          )}
          {state.selectedTab === "notes" && (
            <LearningNotesPanel
              busyId={noteBusyId}
              draft={state.noteDraft}
              inputRef={noteInputRef}
              notes={state.notes}
              onDelete={(note) => void removeNote(note)}
              onDraftChange={updateNoteDraft}
              onSave={() => void saveNote()}
              onSeek={seek}
              onUpdate={(note, body) => void editNote(note, body)}
              positionSeconds={notePositionSeconds}
              source={noteCaption.source}
              korean={noteCaption.korean}
              status={noteStatus}
            />
          )}
          {state.selectedTab === "quiz" && (
            <AdaptiveQuizPanel
              answers={quiz.answers}
              loop={quiz.loop}
              onAnswer={quiz.chooseAnswer}
              onPrepareCaptions={prepareCaptionsForQuiz}
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
      <TranscriptDrawer
        captions={displayedCaptions}
        onClose={() => setTranscriptOpen(false)}
        onSeek={(seconds) => {
          seek(seconds);
          setTranscriptOpen(false);
        }}
        open={transcriptOpen}
      />
    </main>
  );
}
