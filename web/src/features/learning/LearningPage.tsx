import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { startLearningIntake } from "../../learningIntake.ts";
import type { Session } from "../../types.ts";
import { extractYouTubeId } from "../../videoMetadata.ts";
import {
  queueVideoFromLearningIntake,
  type QueueVideo,
} from "../../watchQueue.ts";
import { addVideosToQueue, readWatchQueue } from "../../watchQueueStorage.ts";
import { patchLearningSession } from "./useLearningSession.ts";

const DEFAULT_REQUESTED_AUDIO_SECONDS = 600;

export function LearningPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [videoUrl, setVideoUrl] = useState("");
  const [recentVideos, setRecentVideos] = useState<QueueVideo[]>(() =>
    readWatchQueue(),
  );
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUrl = videoUrl.trim();
    const videoId = extractYouTubeId(normalizedUrl);
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      setStatus("지원되는 YouTube 영상 주소를 입력해주세요.");
      queueMicrotask(() => errorRef.current?.focus());
      return;
    }

    setStatus("영상 학습을 준비하고 있습니다.");
    setIsSubmitting(true);
    try {
      const result = await startLearningIntake({
        videoUrl: normalizedUrl,
        requestedAudioSeconds: DEFAULT_REQUESTED_AUDIO_SECONDS,
      });
      const contextId = result.context.studyContext.id;
      const video = queueVideoFromLearningIntake({
        videoId,
        videoUrl: normalizedUrl,
        contextId,
        workId: result.workId,
      });
      const queue = addVideosToQueue([video], video);
      setRecentVideos(queue);
      patchLearningSession(session.user.id, videoId, {
        contextId,
        workId: result.workId,
      });
      navigate(`/watch?videoId=${encodeURIComponent(videoId)}`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "영상 학습을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
      queueMicrotask(() => errorRef.current?.focus());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resume(video: QueueVideo) {
    if (!video.learningContextId) {
      setStatus("기존 영상을 새 학습 화면에 연결하고 있습니다.");
      setIsSubmitting(true);
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
        setStatus(
          error instanceof Error
            ? error.message
            : "기존 영상을 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
        );
        queueMicrotask(() => errorRef.current?.focus());
        return;
      } finally {
        setIsSubmitting(false);
      }
    }
    navigate(`/watch?videoId=${encodeURIComponent(video.videoId)}`);
  }

  return (
    <main className="page-shell learning-home">
      <section className="learning-intake-card">
        <p className="eyebrow">{session.user.name}님의 학습</p>
        <h1>배우고 싶은 영상을 등록하세요</h1>
        <p>
          영상의 언어는 자동으로 확인하고, 한국어 자막과 학습 자료를 차례로
          준비합니다.
        </p>
        <form className="learning-intake-form" onSubmit={handleSubmit}>
          <label htmlFor="learning-video-url">YouTube 영상 주소</label>
          <div>
            <input
              id="learning-video-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
            />
            <button disabled={isSubmitting} type="submit">
              {isSubmitting ? "준비 중" : "학습 시작"}
            </button>
          </div>
        </form>
        <p
          className="learning-intake-status"
          ref={errorRef}
          role={status && !isSubmitting ? "alert" : "status"}
          tabIndex={status && !isSubmitting ? -1 : undefined}
        >
          {status}
        </p>
      </section>

      <section
        className="recent-learning"
        aria-labelledby="recent-learning-title"
      >
        <div className="section-title">
          <div>
            <small>최근 학습</small>
            <h2 id="recent-learning-title">이어서 보기</h2>
          </div>
          <a href="#learning-video-url">새 영상 등록</a>
        </div>
        {recentVideos.length === 0 ? (
          <div className="learning-empty-state">
            <strong>아직 학습한 영상이 없습니다</strong>
            <p>위에 YouTube 주소를 입력하면 첫 학습을 시작할 수 있습니다.</p>
            <a className="primary-link" href="#learning-video-url">
              새 영상 등록
            </a>
          </div>
        ) : (
          <div className="recent-learning-list">
            {recentVideos.slice(0, 6).map((video) => (
              <button
                disabled={isSubmitting}
                key={video.id}
                type="button"
                onClick={() => void resume(video)}
              >
                <img src={video.thumbnailUrl} alt="" />
                <span>
                  <strong>{video.title}</strong>
                  <small>{video.channelName}</small>
                </span>
                <b>이어서 보기</b>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
