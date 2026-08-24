import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureLiveCaptionChunk,
  finalizeLiveCaptions,
} from "../../api.ts";
import {
  blobToBase64,
  mergeLiveCaptionChunk,
  roundCaptionSeconds,
  selectRecordingMimeType,
  type LiveCaptionChunk,
} from "./liveCaptions.ts";

const CHUNK_MILLISECONDS = 5_000;
const MAX_VIDEO_SECONDS = 600;
const MAX_CAPTURE_MILLISECONDS = 10 * 60 * 1_000;
const MAX_PENDING_UPLOADS = 2;

type CapturePhase =
  | "idle"
  | "requesting"
  | "listening"
  | "saving"
  | "complete"
  | "failed";

type CaptureStatus = Readonly<{
  phase: CapturePhase;
  message: string;
}>;

type CaptureRuntime = {
  active: boolean;
  finalizing: boolean;
  sessionId: string;
  ordinal: number;
  stream: MediaStream;
  recorder: MediaRecorder | null;
  timer: number;
  pending: Set<Promise<void>>;
  savedChunks: number;
  startedAt: number;
  failureMessage?: string;
};

type ExtendedDisplayMediaOptions = DisplayMediaStreamOptions & {
  preferCurrentTab: boolean;
  selfBrowserSurface: "include";
  surfaceSwitching: "exclude";
  systemAudio: "exclude";
};

export function useLiveCaptionCapture(input: {
  contextId: string;
  currentTime: number;
  onFinalized: () => void;
}) {
  const { contextId, currentTime, onFinalized } = input;
  const [status, setStatus] = useState<CaptureStatus>({
    phase: "idle",
    message: "",
  });
  const [chunks, setChunks] = useState<LiveCaptionChunk[]>([]);
  const currentTimeRef = useRef(currentTime);
  const runtimeRef = useRef<CaptureRuntime | null>(null);
  const recordNextRef = useRef<() => void>(() => undefined);
  const transition = useCallback((phase: CapturePhase, message: string) => {
    setStatus({ phase, message });
  }, []);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const closeStream = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    window.clearTimeout(runtime.timer);
    for (const track of runtime.stream.getTracks()) track.stop();
  }, []);

  const finalize = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.finalizing) return;
    runtime.finalizing = true;
    transition("saving", "자막을 저장하고 있어요.");
    await Promise.allSettled([...runtime.pending]);
    try {
      if (runtime.savedChunks > 0) {
        await finalizeLiveCaptions({
          contextId,
          sessionId: runtime.sessionId,
        });
        onFinalized();
        transition(
          runtime.failureMessage ? "failed" : "complete",
          runtime.failureMessage
            ? `${runtime.failureMessage} 저장된 자막까지만 남겼어요.`
            : "자막을 저장했어요. 퀴즈를 준비하고 있어요.",
        );
      } else {
        transition(
          runtime.failureMessage ? "failed" : "idle",
          runtime.failureMessage || "재생 중인 구간에서 다시 시작해주세요.",
        );
      }
    } catch (error) {
      transition("failed", captureErrorMessage(error));
    } finally {
      closeStream();
      runtimeRef.current = null;
    }
  }, [closeStream, contextId, onFinalized, transition]);

  const recordNext = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtime.active || runtime.finalizing) return;
    if (performance.now() - runtime.startedAt >= MAX_CAPTURE_MILLISECONDS) {
      runtime.active = false;
      void finalize();
      return;
    }
    const startSeconds = roundCaptionSeconds(currentTimeRef.current);
    if (startSeconds >= MAX_VIDEO_SECONDS) {
      runtime.active = false;
      void finalize();
      return;
    }
    const audioTrack = runtime.stream.getAudioTracks()[0];
    if (!audioTrack) {
      runtime.active = false;
      transition("failed", "탭 공유 창에서 오디오 공유를 켜주세요.");
      closeStream();
      runtimeRef.current = null;
      return;
    }
    const mimeType = selectRecordingMimeType(MediaRecorder.isTypeSupported);
    if (!mimeType) {
      runtime.active = false;
      transition(
        "failed",
        "이 브라우저에서는 탭 소리로 자막을 만들 수 없습니다.",
      );
      closeStream();
      runtimeRef.current = null;
      return;
    }
    const recorder = new MediaRecorder(new MediaStream([audioTrack]), {
      mimeType,
      audioBitsPerSecond: 32_000,
    });
    runtime.recorder = recorder;
    const parts: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = () => {
      const current = runtimeRef.current;
      if (!current || current !== runtime) return;
      window.clearTimeout(current.timer);
      current.recorder = null;
      const endSeconds = roundCaptionSeconds(
        Math.min(currentTimeRef.current, MAX_VIDEO_SECONDS),
      );
      const duration = endSeconds - startSeconds;
      const ordinal = current.ordinal;
      current.ordinal += 1;

      if (duration >= 0.25 && duration <= 12 && parts.length > 0) {
        const upload = blobToBase64(new Blob(parts, { type: mimeType }))
          .then((audioBase64) =>
            captureLiveCaptionChunk({
              contextId,
              sessionId: current.sessionId,
              ordinal,
              startSeconds,
              endSeconds,
              mimeType,
              audioBase64,
            }),
          )
          .then((chunk) => {
            current.savedChunks += 1;
            setChunks((previous) => mergeLiveCaptionChunk(previous, chunk));
          })
          .catch((error: unknown) => {
            current.active = false;
            current.failureMessage = captureErrorMessage(error);
            if (current.recorder?.state === "recording") current.recorder.stop();
            transition("failed", current.failureMessage);
          })
          .finally(() => current.pending.delete(upload));
        current.pending.add(upload);
      } else if (duration < 0 || duration > 12) {
        current.active = false;
        current.failureMessage =
          "영상 위치를 바꾼 뒤 자막을 다시 시작해주세요.";
        transition("failed", current.failureMessage);
      } else if (duration < 0.25) {
        current.active = false;
      }

      if (current.active && endSeconds < MAX_VIDEO_SECONDS) {
        if (current.pending.size >= MAX_PENDING_UPLOADS) {
          void Promise.race([...current.pending]).then(() => {
            if (runtimeRef.current === current && current.active) {
              recordNextRef.current();
            }
          });
        } else {
          recordNextRef.current();
        }
      }

      if (!current.active || endSeconds >= MAX_VIDEO_SECONDS) void finalize();
    };
    recorder.start();
    runtime.timer = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, CHUNK_MILLISECONDS);
  }, [closeStream, contextId, finalize, transition]);

  useEffect(() => {
    recordNextRef.current = recordNext;
  }, [recordNext]);

  const start = useCallback(async () => {
    if (!contextId || runtimeRef.current) return;
    if (currentTimeRef.current >= MAX_VIDEO_SECONDS) {
      transition("failed", "자막은 영상 앞부분 10분까지 만들 수 있습니다.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      transition("failed", "Chrome 데스크톱에서 자막을 시작해주세요.");
      return;
    }
    transition("requesting", "현재 탭과 탭 오디오를 선택해주세요.");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
      } as ExtendedDisplayMediaOptions);
      if (stream.getAudioTracks().length === 0) {
        for (const track of stream.getTracks()) track.stop();
        throw new Error("탭 공유 창에서 오디오 공유를 켜주세요.");
      }
      runtimeRef.current = {
        active: true,
        finalizing: false,
        sessionId: crypto.randomUUID(),
        ordinal: 0,
        stream,
        recorder: null,
        timer: 0,
        pending: new Set(),
        savedChunks: 0,
        startedAt: performance.now(),
      };
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        runtime.active = false;
        if (runtime.recorder?.state === "recording") runtime.recorder.stop();
        else void finalize();
      });
      setChunks([]);
      transition("listening", "재생 중인 영상의 자막을 만들고 있어요.");
      recordNext();
    } catch (error) {
      transition("failed", captureErrorMessage(error));
    }
  }, [contextId, finalize, recordNext, transition]);

  const stop = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.active = false;
    if (runtime.recorder?.state === "recording") runtime.recorder.stop();
    else void finalize();
  }, [finalize]);

  useEffect(
    () => () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.active = false;
      window.clearTimeout(runtime.timer);
      if (runtime.recorder?.state === "recording") runtime.recorder.stop();
      closeStream();
      runtimeRef.current = null;
    },
    [closeStream],
  );

  return {
    chunks,
    message: status.message,
    phase: status.phase,
    start,
    stop,
    active: status.phase === "requesting" || status.phase === "listening",
  };
}

function captureErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "탭 공유를 취소했습니다.";
  }
  return error instanceof Error && /[가-힣]/u.test(error.message)
    ? error.message
    : "자막을 만들지 못했습니다. 잠시 후 다시 시도해주세요.";
}
