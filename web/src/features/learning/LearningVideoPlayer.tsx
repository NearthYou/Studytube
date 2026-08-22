import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

type YoutubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
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
      };
    },
  ) => YoutubePlayer;
};

type YoutubeWindow = Window & {
  YT?: YoutubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

export type LearningVideoPlayerHandle = {
  seek: (seconds: number) => void;
};

export const LearningVideoPlayer = forwardRef<
  LearningVideoPlayerHandle,
  {
    initialTime: number;
    onTimeChange: (seconds: number) => void;
    videoId: string;
  }
>(function LearningVideoPlayer({ initialTime, onTimeChange, videoId }, ref) {
  const playerRef = useRef<YoutubePlayer | null>(null);
  const initialTimeRef = useRef(initialTime);
  const onTimeChangeRef = useRef(onTimeChange);
  const errorRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  onTimeChangeRef.current = onTimeChange;

  useImperativeHandle(
    ref,
    () => ({
      seek(seconds: number) {
        playerRef.current?.seekTo(seconds, true);
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let interval = 0;
    async function mountPlayer() {
      try {
        const youtube = await loadYoutubeApi();
        if (cancelled) return;
        playerRef.current?.destroy();
        playerRef.current = new youtube.Player("learning-youtube-player", {
          videoId,
          playerVars: { rel: 0, playsinline: 1, enablejsapi: 1 },
          events: {
            onReady: ({ target }) => {
              playerRef.current = target;
              target.seekTo(initialTimeRef.current, true);
              setError("");
            },
            onError: () => {
              setError(
                "영상을 재생할 수 없습니다. 원본 영상이 공개 상태인지 확인해주세요.",
              );
            },
          },
        });
        interval = window.setInterval(() => {
          try {
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
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return (
    <section className="learning-player" aria-label="YouTube 영상 플레이어">
      <div id="learning-youtube-player" />
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
