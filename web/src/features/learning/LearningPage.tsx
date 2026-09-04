import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { startLearningIntake } from "../../learningIntake.ts";
import type { Session } from "../../types.ts";
import type { QueueVideo } from "../../watchQueue.ts";
import { addVideosToQueue, readWatchQueue } from "../../watchQueueStorage.ts";
import { LearningIntakeForm } from "./LearningIntakeForm.tsx";
import { patchLearningSession } from "./useLearningSession.ts";

const DEFAULT_REQUESTED_AUDIO_SECONDS = 600;

export function LearningPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [recentVideos, setRecentVideos] = useState<QueueVideo[]>(() =>
    readWatchQueue(),
  );
  const [status, setStatus] = useState("");
  const [isResuming, setIsResuming] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function resume(video: QueueVideo) {
    if (!video.learningContextId) {
      setStatus("지난 영상을 다시 준비하고 있어요.");
      setIsResuming(true);
      try {
        const result = await startLearningIntake({
          videoUrl: video.videoUrl,
          requestedAudioSeconds: DEFAULT_REQUESTED_AUDIO_SECONDS,
        });
        const contextId = result.context.studyContext.id;
        const connectedVideo = {
          ...video,
          learningContextId: contextId,
          learningWorkId: result.workId,
        };
        const queue = addVideosToQueue([connectedVideo], connectedVideo);
        setRecentVideos(queue);
        patchLearningSession(session.user.id, video.videoId, {
          contextId,
          workId: result.workId,
        });
      } catch (error) {
        void error;
        setStatus("영상을 다시 열지 못했어요. 잠시 후 다시 해 주세요.");
        queueMicrotask(() => errorRef.current?.focus());
        return;
      } finally {
        setIsResuming(false);
      }
    }
    navigate(`/watch?videoId=${encodeURIComponent(video.videoId)}`);
  }

  const recentVideo = recentVideos[0];

  return (
    <main className="page-shell learning-home">
      <section className="learning-intake-card">
        <div className="learning-intake-copy">
          <h1>보고 싶은 유튜브 영상을 넣어보세요</h1>
          <p>
            원문과 번역을 함께 보고, 어려운 문장은 멈춰서 바로 확인할 수
            있어요.
          </p>
        </div>
        <LearningIntakeForm session={session} onQueued={setRecentVideos} />
        {!recentVideo && (
          <div className="learning-first-guide" aria-label="학습에서 할 수 있는 일">
            <span>원문과 번역을 함께 보기</span>
            <span>놓친 문장 바로 이해하기</span>
            <span>기억할 문장 저장하기</span>
          </div>
        )}
      </section>

      {recentVideo && (
        <section
          className="recent-learning"
          aria-labelledby="recent-learning-title"
        >
          <div className="section-title">
            <h2 id="recent-learning-title">최근 보던 영상</h2>
          </div>
          <div className="recent-learning-list">
            <button
              disabled={isResuming}
              type="button"
              onClick={() => void resume(recentVideo)}
            >
              <img src={recentVideo.thumbnailUrl} alt="" />
              <span>
                <strong>{recentVideo.title}</strong>
                <small>{recentVideo.channelName}</small>
              </span>
              <b>{isResuming ? "여는 중" : "계속 보기"}</b>
            </button>
          </div>
          <p
            className="learning-intake-status"
            ref={errorRef}
            role={status && !isResuming ? "alert" : "status"}
            tabIndex={status && !isResuming ? -1 : undefined}
          >
            {status}
          </p>
        </section>
      )}
    </main>
  );
}
