import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { askMcp } from "../../api.ts";
import { startLearningIntake } from "../../learningIntake.ts";
import type { Session } from "../../types.ts";
import { extractYouTubeId } from "../../videoMetadata.ts";
import {
  queueVideoFromLearningIntake,
  type QueueVideo,
} from "../../watchQueue.ts";
import { addVideosToQueue } from "../../watchQueueStorage.ts";
import { patchLearningSession } from "./useLearningSession.ts";

const DEFAULT_REQUESTED_AUDIO_SECONDS = 600;

export function LearningIntakeForm({
  inputId = "learning-video-url",
  onQueued,
  session,
}: {
  inputId?: string;
  onQueued?: (queue: QueueVideo[]) => void;
  session: Session;
}) {
  const navigate = useNavigate();
  const [videoUrl, setVideoUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const normalizedUrl = videoUrl.trim();
    const videoId = extractYouTubeId(normalizedUrl);
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      setStatus("YouTube 영상 주소를 확인해 주세요.");
      queueMicrotask(() => statusRef.current?.focus());
      return;
    }

    setStatus("영상을 준비하고 있어요.");
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const [result, metadataResponse] = await Promise.all([
        startLearningIntake({
          videoUrl: normalizedUrl,
          requestedAudioSeconds: DEFAULT_REQUESTED_AUDIO_SECONDS,
        }),
        askMcp({ url: normalizedUrl, limit: 1 }).catch(() => null),
      ]);
      const contextId = result.context.studyContext.id;
      const queuedVideo = queueVideoFromLearningIntake({
        videoId,
        videoUrl: normalizedUrl,
        contextId,
        workId: result.workId,
      });
      const metadata =
        metadataResponse?.result?.videos[0] ?? metadataResponse?.result;
      const metadataSummary = metadata?.summary?.trim();
      const video: QueueVideo = {
        ...queuedVideo,
        title: metadata?.title?.trim() || queuedVideo.title,
        channelName: metadata?.channel?.trim() || queuedVideo.channelName,
        thumbnailUrl: metadata?.thumbnailUrl?.trim() || queuedVideo.thumbnailUrl,
        summary:
          metadataSummary &&
          metadataSummary !==
            "YouTube oEmbed metadata fetched through the MCP server."
            ? metadataSummary
            : "",
      };
      const queue = addVideosToQueue([video], video);
      patchLearningSession(session.user.id, videoId, {
        contextId,
        workId: result.workId,
      });
      onQueued?.(queue);
      navigate(`/watch?videoId=${encodeURIComponent(videoId)}`);
    } catch {
      setStatus("영상을 열지 못했어요. 잠시 후 다시 해 주세요.");
      queueMicrotask(() => statusRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form className="learning-intake-form" onSubmit={handleSubmit}>
      <label htmlFor={inputId}>YouTube 영상 주소</label>
      <div>
        <input
          id={inputId}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
        />
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "여는 중" : "영상 열기"}
        </button>
      </div>
      <p
        className="learning-intake-status"
        ref={statusRef}
        role={status && !isSubmitting ? "alert" : "status"}
        tabIndex={status && !isSubmitting ? -1 : undefined}
      >
        {status}
      </p>
    </form>
  );
}
