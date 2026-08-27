import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { youtubePlayerVars } from "./youtubePlayerOptions.ts";

type YoutubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  unloadModule?: (module: string) => void;
};

type YoutubeApi = {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars: Record<string, number>;
      events: {
        onReady: (event: { target: YoutubePlayer }) => void;
        onError: () => void;
        onStateChange: (event: { data: number; target: YoutubePlayer }) => void;
      };
    },
  ) => YoutubePlayer;
};

type YoutubeWindow = Window & {
  YT?: YoutubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

export type LearningVideoPlayerHandle = {
  pause: () => void;
  play: () => void;
  seek: (seconds: number) => void;
};

export const LearningVideoPlayer = forwardRef<
  LearningVideoPlayerHandle,
  {
    caption: { korean: string; source: string };
    initialTime: number;
    onDurationChange: (seconds: number) => void;
    onEnded: (positionSeconds: number, durationSeconds: number) => void;
    onTimeChange: (seconds: number) => void;
    videoId: string;
  }
>(function LearningVideoPlayer(
  {
    caption,
    initialTime,
    onDurationChange,
    onEnded,
    onTimeChange,
    videoId,
  },
  ref,
) {
  const playerRef = useRef<YoutubePlayer | null>(null);
  const initialTimeRef = useRef(initialTime);
  const controlsTimerRef = useRef(0);
  const playingRef = useRef(false);
  const onTimeChangeRef = useRef(onTimeChange);
  const onDurationChangeRef = useRef(onDurationChange);
  const onEndedRef = useRef(onEnded);
  const errorRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [captionSize, setCaptionSize] = useState<"small" | "medium" | "large">(
    "medium",
  );
  onTimeChangeRef.current = onTimeChange;
  onDurationChangeRef.current = onDurationChange;
  onEndedRef.current = onEnded;

  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(controlsTimerRef.current);
    if (playingRef.current) {
      controlsTimerRef.current = window.setTimeout(
        () => setControlsVisible(false),
        2_800,
      );
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      pause() {
        playerRef.current?.pauseVideo();
      },
      play() {
        playerRef.current?.playVideo();
      },
      seek(seconds: number) {
        playerRef.current?.seekTo(seconds, true);
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let interval = 0;
    let nativeCaptionTicks = 0;
    async function mountPlayer() {
      try {
        const youtube = await loadYoutubeApi();
        if (cancelled) return;
        playerRef.current?.destroy();
        playerRef.current = new youtube.Player("learning-youtube-player", {
          videoId,
          playerVars: youtubePlayerVars(initialTimeRef.current),
          events: {
            onReady: ({ target }) => {
              playerRef.current = target;
              target.unloadModule?.("captions");
              const duration = target.getDuration();
              if (Number.isFinite(duration) && duration > 0) {
                onDurationChangeRef.current(duration);
              }
              setError("");
            },
            onError: () => {
              setError(
                "영상을 재생할 수 없습니다. 원본 영상이 공개 상태인지 확인해주세요.",
              );
            },
            onStateChange: ({ data, target }) => {
              target.unloadModule?.("captions");
              playingRef.current = data === 1;
              if (data === 1) {
                showControlsTemporarily();
              } else {
                window.clearTimeout(controlsTimerRef.current);
                setControlsVisible(true);
              }
              if (data === 0) {
                onEndedRef.current(target.getCurrentTime(), target.getDuration());
              }
            },
          },
        });
        interval = window.setInterval(() => {
          try {
            nativeCaptionTicks += 1;
            if (nativeCaptionTicks % 4 === 0) {
              playerRef.current?.unloadModule?.("captions");
            }
            const seconds = playerRef.current?.getCurrentTime();
            if (typeof seconds === "number" && Number.isFinite(seconds)) {
              onTimeChangeRef.current(seconds);
            }
          } catch {
            // Preserve the last valid position while the player changes state.
          }
        }, 500);
      } catch {
        if (!cancelled) {
          setError(
            "플레이어를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.",
          );
        }
      }
    }
    void mountPlayer();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(controlsTimerRef.current);
      try {
        const currentTime = playerRef.current?.getCurrentTime();
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
          initialTimeRef.current = currentTime;
        }
      } catch {
        // The iframe may finish its own teardown before React unmounts it.
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [showControlsTemporarily, videoId]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return (
    <>
      <section
        className={`learning-player caption-size-${captionSize}${controlsVisible ? " controls-visible" : ""}`}
        aria-label="YouTube 영상 플레이어"
        onPointerEnter={showControlsTemporarily}
        onPointerDown={showControlsTemporarily}
        onPointerMove={showControlsTemporarily}
        onTouchStart={showControlsTemporarily}
      >
        <div id="learning-youtube-player" />
        {(caption.korean || caption.source) && (
          <div className="learning-player-caption" aria-live="polite">
            {caption.source && (
              <p className="learning-caption-source">{caption.source}</p>
            )}
            {caption.korean && (
              <p className="learning-caption-korean">{caption.korean}</p>
            )}
          </div>
        )}
        {error && (
          <div
            className="learning-player-error"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            <strong>영상을 열 수 없습니다</strong>
            <p>{error}</p>
            <Link to="/">다른 영상 선택</Link>
          </div>
        )}
      </section>
      <div className="learning-caption-settings" role="group" aria-label="자막 크기">
        <span>자막 크기</span>
        {(["small", "medium", "large"] as const).map((size) => (
          <button
            aria-pressed={captionSize === size}
            key={size}
            type="button"
            onClick={() => setCaptionSize(size)}
          >
            {{ small: "작게", medium: "보통", large: "크게" }[size]}
          </button>
        ))}
      </div>
    </>
  );
});

let youtubeApiPromise: Promise<YoutubeApi> | null = null;

function loadYoutubeApi(): Promise<YoutubeApi> {
  const youtubeWindow = window as unknown as YoutubeWindow;
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = youtubeWindow.onYouTubeIframeAPIReady;
    let scriptElement: HTMLScriptElement | null = null;
    let settled = false;
    const cleanup = () => {
      youtubeWindow.onYouTubeIframeAPIReady = previousReady;
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      scriptElement?.remove();
      youtubeApiPromise = null;
      reject(new Error(message));
    };
    const timeout = window.setTimeout(
      () => fail("플레이어 준비 시간이 초과되었습니다."),
      8000,
    );
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (!youtubeWindow.YT?.Player || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve(youtubeWindow.YT);
    };
    scriptElement = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (scriptElement) {
      scriptElement.addEventListener(
        "error",
        () => fail("플레이어 스크립트를 불러오지 못했습니다."),
        { once: true },
      );
    } else {
      scriptElement = document.createElement("script");
      scriptElement.src = "https://www.youtube.com/iframe_api";
      scriptElement.async = true;
      scriptElement.onerror = () =>
        fail("플레이어 스크립트를 불러오지 못했습니다.");
      document.head.append(scriptElement);
    }
  });
  return youtubeApiPromise;
}
